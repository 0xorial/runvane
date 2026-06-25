import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ChatChain } from '../conversations/chat-chain.js';
import { LifecycleScope } from '../conversations/lifecycle-scope.js';
import { SseType } from '../contracts/sse.js';
import { AgentsRepo } from '../db/repositories/agents.repo.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../sse/sse-helpers.js';
import { TaskRegistryService } from '../tasks/task-registry.service.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import { PlannerThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/plannerProvider.js';
import type { LlmRef } from '../thoughtProcessing/types.js';
import { mostPermissivePermission, type ToolPermission } from './base-tool.js';
import { ToolRegistry } from './tool-registry.js';
import type { AgentToolConfig } from '../agents/agent.entity.js';
import type { GuardrailConfig } from '../contracts/guardrail.js';
import { resolveToolConfig } from './resolve-tool-config.js';

/**
 * Identifies the fan-out batch a tool belongs to. When the planner requests N
 * tools in one decision, all N share one `{ id, size: N }`. The planner only
 * continues once every member of the batch has reached a terminal state — see
 * {@link RunToolService.memberResolved}. Stamped onto the tool-invocation entry
 * (via `toParametersPayload`) so a tool approved/denied in a later HTTP request
 * still resolves against the same batch.
 */
export type ToolBatchRef = { id: string; size: number };

export type RunToolInput = {
  conversationId: string;
  agentId: string;
  toolName: string;
  params: unknown;
  toolRequest?: string;
  approvalGranted?: boolean;
  plannerFollowup?: { mode: 'continue' | 'finalize' };
  toolBatch?: ToolBatchRef;
  guardrailConfig?: GuardrailConfig;
  /**
   * Set by the guardrail thought provider when the guardrail LLM flagged the
   * call. Forces the request to be blocked with this reason — surfaces in the
   * UI as a guardrail-tagged "needs approval" tool row.
   */
  guardrailFlagReason?: string;
  /**
   * The thoughtId of the thought that decided to run this tool (toolParams or
   * guardrail). Tool-invocation chain entries cluster with that thought so a
   * later reprocess of the deciding thought includes its tool result in the
   * new branch's lineage.
   */
  decidingThoughtId?: string;
  toolOverrides?: Record<string, AgentToolConfig>;
};

export type RunToolResult = { kind: 'skipped' } | { kind: 'completed'; toolEntryId: string } | { kind: 'blocked'; toolEntryId: string };

type ToolEnvelope = {
  ok: boolean;
  toolId: string;
  output: unknown;
  error: string | null;
  permission_state: ToolPermission;
  timing: { started_at: string; finished_at: string; elapsed_ms: number };
};

type ToolBatchState = { size: number; resolved: Set<string>; continued: boolean };

@Injectable()
export class RunToolService {
  private readonly logger = new Logger(RunToolService.name);

  /**
   * Fan-in state per tool-fanout batch, keyed by `ToolBatchRef.id`. Lives in
   * the (singleton) service so it survives across the separate HTTP requests
   * that approve/deny a tool. An entry is created lazily on the first member to
   * resolve and deleted once the planner continuation has been kicked off.
   */
  private readonly toolBatches = new Map<string, ToolBatchState>();

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly tools: ToolRegistry,
    private readonly hub: SseHubService,
    private readonly agents: AgentsRepo,
    @Inject(forwardRef(() => ThoughtProcessingService))
    private readonly thoughtProcessing: ThoughtProcessingService,
    @Inject(forwardRef(() => PlannerThoughtTypeProvider))
    private readonly plannerProvider: PlannerThoughtTypeProvider,
    private readonly taskRegistry: TaskRegistryService,
  ) {}

  async run(input: RunToolInput, scope: LifecycleScope, chain: ChatChain, llm: LlmRef): Promise<RunToolResult> {
    const tool = this.tools.get(input.toolName);
    if (!tool) {
      const reason = `Tool not found: ${input.toolName}`;
      const entryId = await this.appendErrorEntry(input, reason, chain);
      throw new Error(reason + ` (entry=${entryId})`);
    }

    // Per-tool config is owned by the agent — load it here rather than threading
    // it through ToolParamsInput/GuardrailProviderInput/RunToolInput.
    const agent = await this.agents.get(input.agentId);
    const toolCfg = resolveToolConfig(agent, input.toolOverrides, input.toolName);

    const parsedRules = tool.parseRules(toolCfg.rules ?? tool.getDefaultRules());
    const parsedParams = tool.parseParams(input.params);
    const chainTip = chain.getTip();
    if (!chainTip) throw new Error(`runTool: chain tip is unset (conversation=${input.conversationId})`);
    const entries = await this.chatEntries.listChatEntriesFromLeaf(input.conversationId, chainTip);

    // Static, config-level permission gate — the same Off / Ask / Allow the
    // settings UI surfaces, resolved centrally here so each tool's
    // evaluatePermission no longer has to translate its own `allowed` rule.
    // evaluatePermission still runs below for the allow case, so a tool can
    // keep returning 'ask_user'/'forbid' for dynamic, per-call reasons (e.g.
    // the api tool, which always asks).
    const configPermission = this.resolveConfigPermission(toolCfg, parsedRules);
    if (configPermission === 'forbid') {
      // "Off": tool disabled or allowed='never'. A forbidden tool is a terminal
      // (resolved) batch member, so count it toward the fan-in before returning.
      const blocked = await this.recordBlocked({ input, permission: 'forbid', parsedParams, chain });
      this.memberResolved({ input, entryId: blocked.toolEntryId, scope, chain, llm });
      return blocked;
    }
    // Guardrail-flagged calls block with permission='ask_user' even when the
    // config/rules would allow — user must approve past the guardrail.
    if (input.guardrailFlagReason && input.approvalGranted !== true) {
      return this.recordBlocked({
        input,
        permission: 'ask_user',
        parsedParams,
        chain,
        guardrailReason: input.guardrailFlagReason,
      });
    }
    if (configPermission === 'ask_user' && input.approvalGranted !== true) {
      // "Ask": allowed='ask'. Request approval up front — no need to consult
      // the tool's own permission check first.
      return this.recordBlocked({ input, permission: 'ask_user', parsedParams, chain });
    }

    // Config allows (or the user already approved). Let the tool apply any
    // dynamic, per-call permission logic of its own — it can still escalate to
    // 'ask_user'/'forbid' here.
    scope.throwIfAborted();
    const ruleResults = await tool.evaluatePermission({
      conversationId: input.conversationId,
      agentId: input.agentId,
      entries,
      agentToolConfig: {
        enabled: toolCfg.enabled !== false,
        policy: 'allow',
        rules: parsedRules,
      },
    });
    const permission = mostPermissivePermission(ruleResults);
    if (permission === 'forbid') {
      const blocked = await this.recordBlocked({ input, permission, parsedParams, chain });
      this.memberResolved({ input, entryId: blocked.toolEntryId, scope, chain, llm });
      return blocked;
    }
    if (permission === 'ask_user' && input.approvalGranted !== true) {
      return this.recordBlocked({ input, permission, parsedParams, chain });
    }

    return this.executeTool({
      input,
      tool,
      parsedParams,
      parsedRules,
      entries,
      scope,
      chain,
      llm,
    });
  }

  /**
   * The tool's static permission as configured on the agent — the same
   * Off / Ask / Allow the settings UI surfaces. A tool turned off
   * (`enabled: false`) or with `allowed: 'never'` is forbidden; `allowed: 'ask'`
   * requires user approval; anything else (`allowed: 'always'`, or a tool with
   * no `allowed` rule) returns 'allow' and defers to the tool's own
   * evaluatePermission.
   */
  private resolveConfigPermission(toolCfg: AgentToolConfig, parsedRules: Record<string, unknown>): ToolPermission {
    if (toolCfg.enabled === false) return 'forbid';
    const allowed = parsedRules.allowed;
    if (allowed === 'never') return 'forbid';
    if (allowed === 'ask') return 'ask_user';
    return 'allow';
  }

  /**
   * User-approval path: the user clicked "Approve & run" on a `requested`
   * tool-invocation entry. Validates synchronously (errors surface to the
   * HTTP caller), then runs the tool in a spawned task — updating that exact
   * entry `requested → running → done` and continuing the planner afterward.
   */
  async approveAndRun(
    args: { conversationId: string; toolEntryId: string; agentId: string },
    scope: LifecycleScope,
    chain: ChatChain,
    llm: LlmRef,
  ): Promise<void> {
    const entry = await this.chatEntries.getChatEntry(args.conversationId, args.toolEntryId);
    if (!entry || entry.type !== 'tool-invocation') {
      throw new Error(`approve: entry ${args.toolEntryId} is not a tool-invocation`);
    }
    if (entry.state !== 'requested') {
      throw new Error(`approve: tool invocation ${args.toolEntryId} is not awaiting approval (state=${entry.state})`);
    }
    const tool = this.tools.get(entry.toolId);
    if (!tool) throw new Error(`approve: unknown tool ${entry.toolId}`);

    // Strip the planner-meta keys toParametersPayload() added to recover the
    // real tool params; the tool's strict param schema rejects extras.
    const { tool_request, source: _source, __tool_batch, ...rawParams } = entry.parameters;
    const toolRequest = typeof tool_request === 'string' ? tool_request : undefined;
    const toolBatch = parseToolBatch(__tool_batch);

    const entries = await this.chatEntries.listChatEntriesFromLeaf(args.conversationId, args.toolEntryId);
    const anchorUser = [...entries].reverse().find((e) => e.type === 'user-message');
    const toolOverrides = anchorUser?.type === 'user-message' ? anchorUser.overrides?.tools : undefined;

    const agent = await this.agents.get(args.agentId);
    const toolCfg = resolveToolConfig(agent, toolOverrides, entry.toolId);
    const parsedRules = tool.parseRules(toolCfg.rules ?? tool.getDefaultRules());
    const parsedParams = tool.parseParams(rawParams);

    const input: RunToolInput = {
      conversationId: args.conversationId,
      agentId: args.agentId,
      toolName: entry.toolId,
      params: rawParams,
      approvalGranted: true,
      // After a human-approved tool runs, the planner should take stock and
      // decide whether to continue or finalize.
      plannerFollowup: { mode: 'continue' },
      ...(toolRequest ? { toolRequest } : {}),
      ...(toolBatch ? { toolBatch } : {}),
      ...(toolOverrides ? { toolOverrides } : {}),
    };

    // The planner continuation hangs off the approved tool entry.
    chain.setTip(args.toolEntryId);

    scope.spawn(async () => {
      await this.executeTool({
        input,
        tool,
        parsedParams,
        parsedRules,
        entries,
        scope,
        chain,
        llm,
        existingEntryId: args.toolEntryId,
      });
    });
  }

  /**
   * User-denial path: the user rejected a `requested` tool invocation. Marks
   * the entry terminal as `denied` (the tool never runs), then resolves it as a
   * batch member so the planner continues once every sibling has settled — a
   * denial counts as a resolution, same as a completion or a failure.
   */
  async denyToolInvocation(
    args: { conversationId: string; toolEntryId: string; agentId: string },
    scope: LifecycleScope,
    chain: ChatChain,
    llm: LlmRef,
  ): Promise<void> {
    const entry = await this.chatEntries.getChatEntry(args.conversationId, args.toolEntryId);
    if (!entry || entry.type !== 'tool-invocation') {
      throw new Error(`deny: entry ${args.toolEntryId} is not a tool-invocation`);
    }
    if (entry.state !== 'requested') {
      throw new Error(`deny: tool invocation ${args.toolEntryId} is not awaiting approval (state=${entry.state})`);
    }
    const now = new Date().toISOString();
    const envelope: ToolEnvelope = {
      ok: false,
      toolId: entry.toolId,
      output: null,
      error: 'Denied by user.',
      permission_state: 'ask_user',
      timing: { started_at: now, finished_at: now, elapsed_ms: 0 },
    };
    await this.chatEntries.updateToolInvocation(args.conversationId, {
      id: entry.id,
      state: 'denied',
      result: envelope,
    });
    this.hub.publish(args.conversationId, {
      type: SseType.TOOL_INVOCATION_END,
      chatEntryId: entry.id,
      toolName: entry.toolId,
      output: 'Denied by user.',
      ok: false,
      runContinues: true,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, args.conversationId, entry.id);

    // The planner continuation hangs off the denied entry, mirroring approve.
    chain.setTip(entry.id);
    const toolBatch = parseToolBatch((entry.parameters as Record<string, unknown>).__tool_batch);
    this.memberResolved({
      input: {
        conversationId: args.conversationId,
        agentId: args.agentId,
        toolName: entry.toolId,
        params: {},
        plannerFollowup: { mode: 'continue' },
        ...(toolBatch ? { toolBatch } : {}),
      },
      entryId: entry.id,
      scope,
      chain,
      llm,
    });
  }

  private async appendErrorEntry(input: RunToolInput, reason: string, chain: ChatChain): Promise<string> {
    const startedAt = new Date();
    const envelope: ToolEnvelope = {
      ok: false,
      toolId: input.toolName,
      output: null,
      error: reason,
      permission_state: 'forbid',
      timing: { started_at: startedAt.toISOString(), finished_at: startedAt.toISOString(), elapsed_ms: 0 },
    };
    const created = await chain.append(input.decidingThoughtId ?? null, (parentId) =>
      this.chatEntries.appendToolInvocation(input.conversationId, {
        toolId: input.toolName,
        state: 'error',
        parameters: this.toParametersPayload(input, input.params),
        result: envelope,
        parentId,
      }),
    );
    this.hub.publish(input.conversationId, {
      type: SseType.TOOL_INVOCATION_END,
      chatEntryId: created.id,
      toolName: input.toolName,
      output: reason,
      ok: false,
      runContinues: false,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, input.conversationId, created.id);
    return created.id;
  }

  private async recordBlocked(args: {
    input: RunToolInput;
    permission: ToolPermission;
    parsedParams: unknown;
    chain: ChatChain;
    guardrailReason?: string;
  }): Promise<{ kind: 'blocked'; toolEntryId: string }> {
    const { input, permission, parsedParams, chain, guardrailReason } = args;
    const startedAt = new Date();
    const baseReason = permission === 'ask_user' ? 'Tool requires user approval.' : 'Tool is forbidden by permission rules.';
    const reason = guardrailReason ? `Guardrail flagged: ${guardrailReason}` : baseReason;
    const envelope: ToolEnvelope = {
      ok: false,
      toolId: input.toolName,
      output: null,
      error: reason,
      permission_state: permission,
      timing: { started_at: startedAt.toISOString(), finished_at: startedAt.toISOString(), elapsed_ms: 0 },
    };
    const state = permission === 'ask_user' ? 'requested' : 'error';
    const parameters = this.toParametersPayload(input, parsedParams);

    const created = await chain.append(input.decidingThoughtId ?? null, (p) =>
      this.chatEntries.appendToolInvocation(input.conversationId, {
        toolId: input.toolName,
        state,
        parameters,
        result: envelope,
        parentId: p,
      }),
    );
    const entryId = created.id;
    const parentId = created.parentId;
    if (permission === 'ask_user') {
      this.hub.publish(input.conversationId, {
        type: SseType.TOOL_INVOCATION_START,
        chatEntryId: entryId,
        toolName: input.toolName,
        state: 'requested',
        approvalRequired: true,
        ...(parentId ? { parentId } : {}),
        ...(input.toolRequest ? { argsPreview: input.toolRequest } : {}),
      });
    } else {
      this.hub.publish(input.conversationId, {
        type: SseType.TOOL_INVOCATION_END,
        chatEntryId: entryId,
        toolName: input.toolName,
        output: reason,
        ok: false,
        runContinues: false,
      });
    }
    await publishChatEntryUpsert(this.hub, this.chatEntries, input.conversationId, entryId);
    return { kind: 'blocked', toolEntryId: entryId };
  }

  private async executeTool(args: {
    input: RunToolInput;
    tool: NonNullable<ReturnType<ToolRegistry['get']>>;
    parsedParams: unknown;
    parsedRules: Record<string, unknown>;
    entries: Awaited<ReturnType<ChatEntriesRepo['listChatEntries']>>;
    scope: LifecycleScope;
    chain: ChatChain;
    llm: LlmRef;
    /**
     * When set (user-approval path), the run updates this already-persisted
     * `requested` entry in place (`requested → running → done`) instead of
     * appending a fresh tool-invocation. Caller is responsible for tipping
     * the chain so any planner continuation hangs off this entry.
     */
    existingEntryId?: string;
  }): Promise<RunToolResult> {
    const { input, tool, parsedParams, parsedRules, entries, scope, chain, llm, existingEntryId } = args;
    const startedAt = new Date();
    const startedAtMs = startedAt.getTime();
    const parameters = this.toParametersPayload(input, parsedParams);

    let entryId: string;
    let parentId: string | null = null;
    if (existingEntryId) {
      entryId = existingEntryId;
      await this.chatEntries.updateToolInvocation(input.conversationId, { id: entryId, state: 'running', parameters });
    } else {
      const created = await chain.append(input.decidingThoughtId ?? null, (p) =>
        this.chatEntries.appendToolInvocation(input.conversationId, {
          toolId: input.toolName,
          state: 'running',
          parameters,
          parentId: p,
        }),
      );
      entryId = created.id;
      parentId = created.parentId;
    }
    this.hub.publish(input.conversationId, {
      type: SseType.TOOL_INVOCATION_START,
      chatEntryId: entryId,
      toolName: input.toolName,
      state: 'running',
      approvalRequired: false,
      ...(parentId ? { parentId } : {}),
      ...(input.toolRequest ? { argsPreview: input.toolRequest } : {}),
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, input.conversationId, entryId);

    // Run the tool. A throw here (timeout, connection failure, etc.) must NOT
    // leave the entry stranded in `running` — record it as `error` either way.
    let output: unknown = null;
    let toolError: unknown = null;
    try {
      scope.throwIfAborted();
      // Live progress (stdout, streamed tokens, …) → the running tool row.
      const onProgress = (delta: string): void => {
        if (!delta) return;
        this.hub.publish(input.conversationId, {
          type: SseType.TOOL_INVOCATION_PROGRESS,
          chatEntryId: entryId,
          toolName: input.toolName,
          delta,
        });
      };
      output = await this.taskRegistry.run(
        {
          kind: 'tool',
          title: input.toolName,
          conversationId: input.conversationId,
          parentSignal: scope.signal,
        },
        (taskSignal) =>
          Promise.resolve(
            tool.runTool(parsedParams, {
              conversationId: input.conversationId,
              agentId: input.agentId,
              entries,
              toolRules: parsedRules,
              signal: taskSignal,
              onProgress,
            }),
          ),
      );
      scope.throwIfAborted();
    } catch (err) {
      toolError = err;
    }

    const finishedAt = new Date();
    const timing = {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      elapsed_ms: Math.max(0, finishedAt.getTime() - startedAtMs),
    };
    const aborted =
      scope.signal.aborted || (toolError instanceof Error && toolError.name === 'AbortError');

    if (toolError !== null) {
      const detail = toolError instanceof Error ? toolError.message : String(toolError);
      const envelope: ToolEnvelope = {
        ok: false,
        toolId: input.toolName,
        output: null,
        error: detail,
        permission_state: 'allow',
        timing,
      };
      await this.chatEntries.updateToolInvocation(input.conversationId, {
        id: entryId,
        state: 'error',
        result: envelope,
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, input.conversationId, entryId);
      if (!aborted) {
        this.hub.publish(input.conversationId, {
          type: SseType.TOOL_INVOCATION_END,
          chatEntryId: entryId,
          toolName: input.toolName,
          output: detail,
          ok: false,
          runContinues: input.plannerFollowup?.mode === 'continue',
        });
        // A failed tool is a resolved batch member — continue planning (once
        // every sibling resolves) so the agent can see the failure and adapt.
        this.memberResolved({ input, entryId, scope, chain, llm });
      }
      return { kind: 'completed', toolEntryId: entryId };
    }

    const envelope: ToolEnvelope = {
      ok: true,
      toolId: input.toolName,
      output,
      error: null,
      permission_state: 'allow',
      timing,
    };
    await this.chatEntries.updateToolInvocation(input.conversationId, { id: entryId, state: 'done', result: envelope });
    this.hub.publish(input.conversationId, {
      type: SseType.TOOL_INVOCATION_END,
      chatEntryId: entryId,
      toolName: input.toolName,
      output: stringifyOutput(output),
      ok: true,
      runContinues: input.plannerFollowup?.mode === 'continue',
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, input.conversationId, entryId);

    this.memberResolved({ input, entryId, scope, chain, llm });
    return { kind: 'completed', toolEntryId: entryId };
  }

  /**
   * Records one fan-out batch member reaching a terminal state (done / error /
   * forbidden / denied) and, once **every** member has resolved, continues the
   * planner exactly once. Tools awaiting approval are NOT terminal and must not
   * call this until they are approved (→ run) or denied.
   *
   * Synchronous on purpose: the resolved-set update and the "already continued"
   * test-and-set happen without an intervening await, so concurrently-finishing
   * siblings can't both trip the continuation. Single-tool flows (size 1) and
   * any caller without batch context continue immediately, preserving the old
   * one-tool-then-planner behavior.
   */
  private memberResolved(args: {
    input: RunToolInput;
    entryId: string;
    scope: LifecycleScope;
    chain: ChatChain;
    llm: LlmRef;
  }): void {
    const { input, entryId, scope, chain, llm } = args;
    const shouldContinue = input.plannerFollowup?.mode === 'continue';
    const batch = input.toolBatch;
    if (!batch) {
      if (shouldContinue) this.continuePlanner(input.conversationId, scope, chain, llm);
      return;
    }
    let state = this.toolBatches.get(batch.id);
    if (!state) {
      state = { size: batch.size, resolved: new Set<string>(), continued: false };
      this.toolBatches.set(batch.id, state);
    }
    state.resolved.add(entryId);
    if (state.continued || state.resolved.size < state.size) return;
    state.continued = true;
    this.toolBatches.delete(batch.id);
    if (shouldContinue) this.continuePlanner(input.conversationId, scope, chain, llm);
  }

  private continuePlanner(conversationId: string, scope: LifecycleScope, chain: ChatChain, llm: LlmRef): void {
    if (scope.signal.aborted) return;
    this.thoughtProcessing.startThought({
      provider: this.plannerProvider,
      conversationId,
      scope,
      chain,
      llm,
    });
  }

  /**
   * Resolve a fan-out member whose parameter-resolution thought failed before
   * any tool-invocation entry was created (e.g. the LLM returned unparseable
   * args). Keyed by the failing thought's id since there is no tool entry. Lets
   * the fan-in complete instead of stranding the planner. (A param-resolution
   * failure that throws in prepare/reason — rather than a parse error in
   * runDecision — isn't signaled here; if it is the last member it leaves the
   * planner waiting, same limitation as the summarize-attachment batch.)
   */
  resolveFailedToolParamsMember(args: {
    conversationId: string;
    thoughtId: string;
    toolBatch?: ToolBatchRef;
    plannerFollowup?: { mode: 'continue' | 'finalize' };
    scope: LifecycleScope;
    chain: ChatChain;
    llm: LlmRef;
  }): void {
    this.memberResolved({
      input: {
        conversationId: args.conversationId,
        agentId: '',
        toolName: '',
        params: {},
        ...(args.plannerFollowup ? { plannerFollowup: args.plannerFollowup } : {}),
        ...(args.toolBatch ? { toolBatch: args.toolBatch } : {}),
      },
      entryId: args.thoughtId,
      scope: args.scope,
      chain: args.chain,
      llm: args.llm,
    });
  }

  private toParametersPayload(input: RunToolInput, params: unknown): Record<string, unknown> {
    const base = params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : { raw: params };
    const out: Record<string, unknown> = { ...base };
    if (input.toolRequest) {
      out.tool_request = input.toolRequest;
      out.source = 'planner_tool_request';
    }
    // Persist the fan-out batch on the entry so an approve/deny in a later
    // request can resolve this member against the same batch. Stripped before
    // the tool's strict param schema re-parses (see approveAndRun).
    if (input.toolBatch) out.__tool_batch = input.toolBatch;
    return out;
  }
}

/** Recover a {@link ToolBatchRef} stamped onto a tool-invocation entry's params. */
function parseToolBatch(value: unknown): ToolBatchRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { id, size } = value as Record<string, unknown>;
  if (typeof id !== 'string' || typeof size !== 'number') return undefined;
  return { id, size };
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
