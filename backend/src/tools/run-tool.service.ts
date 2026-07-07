import { forwardRef, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ChatChain } from '../conversations/chat-chain.js';
import { LifecycleScope } from '../conversations/lifecycle-scope.js';
import { SseType } from '../contracts/sse.js';
import { AgentsRepo } from '../db/repositories/agents.repo.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ToolRunsRepo } from '../db/repositories/tool-runs.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../sse/sse-helpers.js';
import { TaskRegistryService } from '../tasks/task-registry.service.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import { PlannerThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/plannerProvider.js';
import type { LlmRef } from '../thoughtProcessing/types.js';
import { mostPermissivePermission, type ToolPermission, type ToolPolicy } from './base-tool.js';
import { ToolRegistry } from './tool-registry.js';
import { stripToolParamEnvelope } from './toolParamEnvelope.js';
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

@Injectable()
export class RunToolService implements OnModuleInit {
  private readonly logger = new Logger(RunToolService.name);

  /**
   * Per-conversation serialization of the fan-in check, so siblings settling
   * concurrently evaluate "any pending tools left?" one at a time. Purely a
   * concurrency gate — the pending state itself is derived from the chat
   * entries (see maybeContinuePlanner), never stored here.
   */
  private readonly continueChecks = new Map<string, Promise<void>>();
  /**
   * batchId → epoch-ms of the last planner continuation for that batch.
   * Collapses siblings that complete the batch in the same instant into one
   * continuation; anything later (a user retry re-running a member) is a new
   * completion and continues planning again.
   */
  private readonly recentBatchContinues = new Map<string, number>();
  private static readonly BATCH_CONTINUE_DEDUPE_MS = 1500;

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly toolRuns: ToolRunsRepo,
    private readonly tools: ToolRegistry,
    private readonly hub: SseHubService,
    private readonly agents: AgentsRepo,
    @Inject(forwardRef(() => ThoughtProcessingService))
    private readonly thoughtProcessing: ThoughtProcessingService,
    @Inject(forwardRef(() => PlannerThoughtTypeProvider))
    private readonly plannerProvider: PlannerThoughtTypeProvider,
    private readonly taskRegistry: TaskRegistryService,
  ) {}

  /**
   * Boot sweep: a tool that was `running` when the process died can never
   * settle — and since pending state is derived from the chat history, a
   * zombie `running` entry would block its wave's fan-in forever. Mark them
   * failed (retryable: permission_state stays 'allow') and close their
   * tool_runs rows. `requested` entries are untouched — approval is still
   * valid across restarts.
   */
  async onModuleInit(): Promise<void> {
    try {
      const zombies = await this.chatEntries.listRunningToolInvocations();
      for (const zombie of zombies) {
        const now = new Date().toISOString();
        const envelope: ToolEnvelope = {
          ok: false,
          toolId: zombie.toolId,
          output: null,
          error: 'The backend restarted while this tool was running. Retry to run it again.',
          permission_state: 'allow',
          timing: { started_at: now, finished_at: now, elapsed_ms: 0 },
        };
        await this.chatEntries.updateToolInvocation(zombie.conversationId, {
          id: zombie.id,
          state: 'error',
          result: envelope,
        });
      }
      const orphanedRuns = await this.toolRuns.sweepOrphanedRunning();
      if (zombies.length > 0 || orphanedRuns > 0) {
        this.logger.warn(`boot sweep: ${zombies.length} zombie running tool entr(ies) marked failed, ${orphanedRuns} orphaned tool_runs row(s) closed`);
      }
    } catch (error) {
      this.logger.error('boot sweep failed', error instanceof Error ? error.stack : String(error));
    }
  }

  async run(input: RunToolInput, scope: LifecycleScope, chain: ChatChain, llm: LlmRef): Promise<RunToolResult> {
    const tool = this.tools.get(input.toolName);
    if (!tool) {
      const reason = `Tool not found: ${input.toolName}`;
      const entryId = await this.appendErrorEntry(input, reason, chain);
      // Tagged so callers know a visible error entry already exists and don't
      // append a second one (see ToolParamsThoughtTypeProvider.startDirect).
      const err = new Error(reason + ` (entry=${entryId})`) as Error & { toolEntryId?: string };
      err.toolEntryId = entryId;
      throw err;
    }

    // Per-tool config is owned by the agent — load it here rather than threading
    // it through ToolParamsInput/GuardrailProviderInput/RunToolInput.
    const agent = await this.agents.get(input.agentId);
    const toolCfg = resolveToolConfig(agent, input.toolOverrides, input.toolName);

    const rawRules = { ...(toolCfg.rules ?? tool.getDefaultRules()) };
    // Drop any legacy per-tool `allowed` rule (superseded by policy) so the
    // tool's strict rules schema doesn't reject older stored configs/overrides.
    delete (rawRules as Record<string, unknown>).allowed;
    const parsedRules = tool.parseRules(rawRules);
    // Models imitate the argument shape their context shows and may echo our
    // stored bookkeeping keys — strip them before the tool's strict schema.
    const parsedParams = tool.parseParams(stripToolParamEnvelope(input.params));
    const chainTip = chain.getTip();
    if (!chainTip) throw new Error(`runTool: chain tip is unset (conversation=${input.conversationId})`);
    const entries = await this.chatEntries.listChatEntriesFromLeaf(input.conversationId, chainTip);

    // Per-agent×tool permission policy — Off / Ask / Allow / Custom, resolved
    // centrally here. `off` denies, `ask` prompts, `allow` runs, and `custom`
    // defers to the tool's own evaluatePermission for dynamic, per-call logic.
    const policy: ToolPolicy = toolCfg.policy ?? 'off';
    if (policy === 'off') {
      // "Off": tool unavailable to this agent. A forbidden tool is a terminal
      // (resolved) batch member, so count it toward the fan-in before returning.
      const blocked = await this.recordBlocked({ input, permission: 'forbid', parsedParams, chain });
      this.memberResolved({ input, scope, chain, llm });
      return blocked;
    }
    // Guardrail-flagged calls block with permission='ask_user' even when the
    // policy would allow — the user must approve past the guardrail.
    if (input.guardrailFlagReason && input.approvalGranted !== true) {
      return this.recordBlocked({
        input,
        permission: 'ask_user',
        parsedParams,
        chain,
        guardrailReason: input.guardrailFlagReason,
      });
    }
    if (policy === 'ask' && input.approvalGranted !== true) {
      // "Ask": request approval up front — no need to consult the tool first.
      return this.recordBlocked({ input, permission: 'ask_user', parsedParams, chain });
    }

    if (policy === 'custom') {
      // "Custom": defer to the tool's own dynamic permission logic, which can
      // escalate to 'ask_user'/'forbid' per call.
      scope.throwIfAborted();
      const ruleResults = await tool.evaluatePermission({
        conversationId: input.conversationId,
        agentId: input.agentId,
        entries,
        rules: parsedRules,
      });
      const permission = mostPermissivePermission(ruleResults);
      if (permission === 'forbid') {
        const blocked = await this.recordBlocked({ input, permission, parsedParams, chain });
        this.memberResolved({ input, scope, chain, llm });
        return blocked;
      }
      if (permission === 'ask_user' && input.approvalGranted !== true) {
        return this.recordBlocked({ input, permission, parsedParams, chain });
      }
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
   * User-approval path: the user clicked "Approve & run" on a `requested`
   * tool-invocation entry. Validates synchronously (errors surface to the
   * HTTP caller), then runs the tool in a spawned task — updating that exact
   * entry `requested → running → done` and continuing the planner afterward.
   */
  async approveAndRun(
    args: {
      conversationId: string;
      toolEntryId: string;
      agentId: string;
      /** User-edited params to run instead of the requested ones. Validated
       *  against the tool's schema before anything is persisted or run; the
       *  entry keeps the originals + an edited flag for the transcript. */
      editedParameters?: Record<string, unknown>;
    },
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
    const { tool_request, source: _source, __tool_batch, ...requestedParams } = entry.parameters;
    const toolRequest = typeof tool_request === 'string' ? tool_request : undefined;
    const toolBatch = parseToolBatch(__tool_batch);

    // Approve-with-edits: run the user's params, keep the model's on record.
    // The client's edit box may round-trip our bookkeeping stamps — drop them
    // (they're re-attached from the stored entry on persist below).
    const edited =
      args.editedParameters === undefined
        ? undefined
        : (stripToolParamEnvelope(args.editedParameters) as Record<string, unknown>);
    const isEdited = edited !== undefined && JSON.stringify(edited) !== JSON.stringify(requestedParams);
    const rawParams = isEdited ? edited : requestedParams;
    if (isEdited) {
      tool.parseParams(edited); // validate before persisting — surfaces as an HTTP error
      await this.chatEntries.mergeEntryPayload(args.conversationId, args.toolEntryId, {
        parameters: {
          ...edited,
          ...(tool_request !== undefined ? { tool_request } : {}),
          ...(_source !== undefined ? { source: _source } : {}),
          ...(__tool_batch !== undefined ? { __tool_batch } : {}),
        },
        originalParameters: requestedParams,
        parametersEdited: true,
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, args.conversationId, args.toolEntryId);
    }

    const entries = await this.chatEntries.listChatEntriesFromLeaf(args.conversationId, args.toolEntryId);
    const anchorUser = [...entries].reverse().find((e) => e.type === 'user-message');
    const toolOverrides = anchorUser?.type === 'user-message' ? anchorUser.overrides?.tools : undefined;

    const agent = await this.agents.get(args.agentId);
    const toolCfg = resolveToolConfig(agent, toolOverrides, entry.toolId);
    const rawRules = { ...(toolCfg.rules ?? tool.getDefaultRules()) };
    // Drop any legacy per-tool `allowed` rule (superseded by policy) so the
    // tool's strict rules schema doesn't reject older stored configs/overrides.
    delete (rawRules as Record<string, unknown>).allowed;
    const parsedRules = tool.parseRules(rawRules);
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
   * User-retry path: the user clicked "Retry" on a failed (`error`) tool
   * invocation. Re-runs the tool with the entry's recorded params, updating the
   * same entry in place (`error → running → done/error`) — the tool_runs table
   * keeps the per-attempt history. The user's click counts as approval (like
   * approve), but a tool whose policy is now `off` stays off. The original
   * fan-out batch resolved long ago, so the retry never re-joins it — it
   * continues the planner by itself once the run settles.
   */
  async retryToolInvocation(
    args: { conversationId: string; toolEntryId: string; agentId: string },
    scope: LifecycleScope,
    chain: ChatChain,
    llm: LlmRef,
  ): Promise<void> {
    const entry = await this.chatEntries.getChatEntry(args.conversationId, args.toolEntryId);
    if (!entry || entry.type !== 'tool-invocation') {
      throw new Error(`retry: entry ${args.toolEntryId} is not a tool-invocation`);
    }
    if (entry.state !== 'error') {
      throw new Error(`retry: tool invocation ${args.toolEntryId} is not failed (state=${entry.state})`);
    }
    // Blocked entries (forbidden / not-found) also persist as `error`, but they
    // never ran — retrying them would bypass the permission decision.
    if (entry.result && entry.result.permission_state !== 'allow') {
      throw new Error(`retry: tool invocation ${args.toolEntryId} was blocked, not failed — nothing to retry`);
    }
    const tool = this.tools.get(entry.toolId);
    if (!tool) throw new Error(`retry: unknown tool ${entry.toolId}`);

    const { tool_request, source: _source, __tool_batch, ...requestedParams } = entry.parameters;
    const toolRequest = typeof tool_request === 'string' ? tool_request : undefined;
    // The batch stamp stays with the entry: the fan-in derives pending state
    // from the chat history, so while the retry runs its wave counts as
    // pending again, and its completion re-checks the whole wave.
    const toolBatch = parseToolBatch(__tool_batch);

    const entries = await this.chatEntries.listChatEntriesFromLeaf(args.conversationId, args.toolEntryId);
    const anchorUser = [...entries].reverse().find((e) => e.type === 'user-message');
    const toolOverrides = anchorUser?.type === 'user-message' ? anchorUser.overrides?.tools : undefined;

    const agent = await this.agents.get(args.agentId);
    const toolCfg = resolveToolConfig(agent, toolOverrides, entry.toolId);
    if ((toolCfg.policy ?? 'off') === 'off') {
      throw new Error(`retry: tool ${entry.toolId} is disabled for this agent`);
    }
    const rawRules = { ...(toolCfg.rules ?? tool.getDefaultRules()) };
    delete (rawRules as Record<string, unknown>).allowed;
    const parsedRules = tool.parseRules(rawRules);
    const parsedParams = tool.parseParams(requestedParams);

    const input: RunToolInput = {
      conversationId: args.conversationId,
      agentId: args.agentId,
      toolName: entry.toolId,
      params: requestedParams,
      approvalGranted: true,
      plannerFollowup: { mode: 'continue' },
      ...(toolRequest ? { toolRequest } : {}),
      ...(toolBatch ? { toolBatch } : {}),
      ...(toolOverrides ? { toolOverrides } : {}),
    };

    // The planner continuation hangs off the retried entry, mirroring approve.
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

    // Per-attempt audit row (attempt/retry lineage derived from prior runs of
    // this entry). Best-effort: bookkeeping must never block the tool itself.
    const run = await this.toolRuns
      .beginRun({
        conversationId: input.conversationId,
        chatEntryId: entryId,
        agentId: input.agentId,
        toolId: input.toolName,
        parameters: parameters,
        startedAt,
      })
      .catch((err) => {
        this.logger.warn(`tool_runs begin failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
    const runId = run?.id ?? null;
    // Stamped on the entry so the transcript shows retries — a 5ms re-failure
    // otherwise looks like nothing happened.
    const attempt = run?.attempt;

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
        ...(attempt !== undefined ? { attempt } : {}),
      });
      if (runId) {
        await this.toolRuns
          .finishRun({
            id: runId,
            status: aborted ? 'aborted' : 'error',
            result: envelope,
            error: detail,
            finishedAt,
            elapsedMs: timing.elapsed_ms,
          })
          .catch(() => undefined);
      }
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
        this.memberResolved({ input, scope, chain, llm });
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
    await this.chatEntries.updateToolInvocation(input.conversationId, {
      id: entryId,
      state: 'done',
      result: envelope,
      ...(attempt !== undefined ? { attempt } : {}),
    });
    if (runId) {
      await this.toolRuns
        .finishRun({ id: runId, status: 'done', result: envelope, finishedAt, elapsedMs: timing.elapsed_ms })
        .catch(() => undefined);
    }
    this.hub.publish(input.conversationId, {
      type: SseType.TOOL_INVOCATION_END,
      chatEntryId: entryId,
      toolName: input.toolName,
      output: stringifyOutput(output),
      ok: true,
      runContinues: input.plannerFollowup?.mode === 'continue',
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, input.conversationId, entryId);

    this.memberResolved({ input, scope, chain, llm });
    return { kind: 'completed', toolEntryId: entryId };
  }

  /**
   * Called when a tool invocation reaches a terminal state (done / error /
   * forbidden / denied). Whether planning resumes is decided from the CHAT
   * HISTORY: if the batch has zero tool invocations still `requested`/`running`
   * and the planner asked to continue, the planner runs. The DB is the single
   * source of truth, so an approval that arrives after a backend restart still
   * fans in correctly — the previous in-memory scoreboard forgot half-resolved
   * batches on every restart and stranded the run. Tools awaiting approval are
   * NOT terminal and must not call this until approved (→ run) or denied.
   */
  private memberResolved(args: {
    input: RunToolInput;
    scope: LifecycleScope;
    chain: ChatChain;
    llm: LlmRef;
  }): void {
    const { input, scope, chain, llm } = args;
    if (input.plannerFollowup?.mode !== 'continue') return;
    const conversationId = input.conversationId;
    // Serialize checks per conversation so concurrently-settling siblings
    // evaluate one at a time against the already-persisted states.
    const prev = this.continueChecks.get(conversationId) ?? Promise.resolve();
    const next = prev.then(() =>
      this.maybeContinuePlanner(input, scope, chain, llm).catch((error) => {
        this.logger.error(
          `tool fan-in check failed: conversation=${conversationId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }),
    );
    this.continueChecks.set(conversationId, next);
    void next.finally(() => {
      if (this.continueChecks.get(conversationId) === next) this.continueChecks.delete(conversationId);
    });
  }

  private async maybeContinuePlanner(
    input: RunToolInput,
    scope: LifecycleScope,
    chain: ChatChain,
    llm: LlmRef,
  ): Promise<void> {
    const batch = input.toolBatch;
    if (batch) {
      // Continue only once TERMINAL members reach the batch's stamped size.
      // Counting pending entries instead is racy: a member that fails before
      // its siblings' entries are inserted sees "0 pending" vacuously and
      // resumes planning while an approval is still on its way to the DB.
      const terminal = await this.chatEntries.countTerminalToolInvocationsInBatch(input.conversationId, batch.id);
      if (terminal < batch.size) return; // members still unresolved (or not yet persisted)
      // Siblings that completed the batch in the same instant each see zero
      // pending; collapse them into one continuation. A later re-completion of
      // the same batch (user retry) is far outside the window and continues.
      const now = Date.now();
      const last = this.recentBatchContinues.get(batch.id) ?? 0;
      if (now - last < RunToolService.BATCH_CONTINUE_DEDUPE_MS) return;
      this.recentBatchContinues.set(batch.id, now);
      if (this.recentBatchContinues.size > 200) {
        for (const [id, t] of this.recentBatchContinues) {
          if (now - t > 60_000) this.recentBatchContinues.delete(id);
        }
      }
    }
    this.continuePlanner(input.conversationId, scope, chain, llm);
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
  /**
   * Direct dispatch (separate_params_resolution off) failed before run() could
   * persist anything — the planner's args didn't parse or were rejected by the
   * tool's schema. Surface a visible, terminal error entry (the next planner
   * round then SEES the failed call and can self-correct, instead of silently
   * re-emitting the same call in a loop) and resolve the batch member so the
   * fan-in isn't stranded.
   */
  async failDirectDispatch(args: {
    input: RunToolInput;
    reason: string;
    scope: LifecycleScope;
    chain: ChatChain;
    llm: LlmRef;
  }): Promise<void> {
    await this.appendErrorEntry(args.input, args.reason, args.chain);
    this.memberResolved({ input: args.input, scope: args.scope, chain: args.chain, llm: args.llm });
  }

  /**
   * Run the fan-in check for a member whose terminal tool-invocation entry
   * ALREADY exists (run() persisted an error entry before throwing). Members
   * without an entry must go through failDirectDispatch instead — the fan-in
   * counts terminal entries against the batch size, so an entry-less
   * resolution would strand the batch.
   */
  resolveFailedToolParamsMember(args: {
    conversationId: string;
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
