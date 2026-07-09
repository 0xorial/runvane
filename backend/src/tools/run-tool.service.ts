import { forwardRef, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
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
  /**
   * The invocation's pre-created spine entry. Created by the planner at
   * dispatch (in request order, so the batch's chain shape is fixed up
   * front); every later phase — params resolution, guardrail, approval,
   * execution — updates this entry in place. Also the causal anchor for a
   * batch-less planner continuation.
   */
  toolEntryId: string;
  params: unknown;
  toolRequest?: string;
  /** The planner's few-word purpose line, re-stamped onto parameters for the UI. */
  toolNote?: string;
  approvalGranted?: boolean;
  plannerFollowup?: { mode: 'continue' | 'finalize' };
  /**
   * A user retry deliberately continues the planner again even though the
   * batch already produced a continuation — the new reaction becomes a
   * sibling branch at the batch tail. Never set on first-time completions.
   */
  forceContinuation?: boolean;
  toolBatch?: ToolBatchRef;
  guardrailConfig?: GuardrailConfig;
  /**
   * Set by the guardrail thought provider when the guardrail LLM flagged the
   * call. Forces the request to be blocked with this reason — surfaces in the
   * UI as a guardrail-tagged "needs approval" tool row.
   */
  guardrailFlagReason?: string;
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

  async run(input: RunToolInput, scope: LifecycleScope, llm: LlmRef): Promise<RunToolResult> {
    const tool = this.tools.get(input.toolName);
    if (!tool) {
      const reason = `Tool not found: ${input.toolName}`;
      await this.failEntry(input, reason);
      // Tagged so callers know the entry already shows the failure and only
      // the batch member still needs resolving (see ToolParamsThoughtTypeProvider).
      const err = new Error(reason + ` (entry=${input.toolEntryId})`) as Error & { toolEntryId?: string };
      err.toolEntryId = input.toolEntryId;
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
    // Tool context = the lineage of this invocation's own entry: the branch it
    // lives on, whatever else runs concurrently elsewhere in the conversation.
    const entries = await this.chatEntries.listChatEntriesFromLeaf(input.conversationId, input.toolEntryId);

    // Per-agent×tool permission policy — Off / Ask / Allow / Custom, resolved
    // centrally here. `off` denies, `ask` prompts, `allow` runs, and `custom`
    // defers to the tool's own evaluatePermission for dynamic, per-call logic.
    const policy: ToolPolicy = toolCfg.policy ?? 'off';
    if (policy === 'off') {
      // "Off": tool unavailable to this agent. A forbidden tool is a terminal
      // (resolved) batch member, so count it toward the fan-in before returning.
      const blocked = await this.recordBlocked({ input, permission: 'forbid', parsedParams });
      this.memberResolved({ input, scope, llm });
      return blocked;
    }
    // Guardrail-flagged calls block with permission='ask_user' even when the
    // policy would allow — the user must approve past the guardrail.
    if (input.guardrailFlagReason && input.approvalGranted !== true) {
      return this.recordBlocked({
        input,
        permission: 'ask_user',
        parsedParams,
        guardrailReason: input.guardrailFlagReason,
      });
    }
    if (policy === 'ask' && input.approvalGranted !== true) {
      // "Ask": request approval up front — no need to consult the tool first.
      return this.recordBlocked({ input, permission: 'ask_user', parsedParams });
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
        const blocked = await this.recordBlocked({ input, permission, parsedParams });
        this.memberResolved({ input, scope, llm });
        return blocked;
      }
      if (permission === 'ask_user' && input.approvalGranted !== true) {
        return this.recordBlocked({ input, permission, parsedParams });
      }
    }

    return this.executeTool({
      input,
      tool,
      parsedParams,
      parsedRules,
      entries,
      scope,
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
    const { tool_request, tool_note, source: _source, __tool_batch, ...requestedParams } = entry.parameters;
    const toolRequest = typeof tool_request === 'string' ? tool_request : undefined;
    const toolNote = typeof tool_note === 'string' ? tool_note : undefined;
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
      toolEntryId: args.toolEntryId,
      params: rawParams,
      approvalGranted: true,
      // After a human-approved tool runs, the planner should take stock and
      // decide whether to continue or finalize.
      plannerFollowup: { mode: 'continue' },
      ...(toolRequest ? { toolRequest } : {}),
      ...(toolNote ? { toolNote } : {}),
      ...(toolBatch ? { toolBatch } : {}),
      ...(toolOverrides ? { toolOverrides } : {}),
    };

    scope.spawn(async () => {
      await this.executeTool({
        input,
        tool,
        parsedParams,
        parsedRules,
        entries,
        scope,
        llm,
      });
    });
  }

  /**
   * User-retry path: the user clicked "Retry" on a failed (`error`) tool
   * invocation. Re-runs the tool with the entry's recorded params, updating the
   * same entry in place (`error → running → done/error`) — the tool_runs table
   * keeps the per-attempt history. The user's click counts as approval (like
   * approve), but a tool whose policy is now `off` stays off. Once the run
   * settles the planner continues again at the batch tail — deliberately, as a
   * sibling branch beside the reaction to the original failure.
   */
  async retryToolInvocation(
    args: { conversationId: string; toolEntryId: string; agentId: string },
    scope: LifecycleScope,
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

    const { tool_request, tool_note, source: _source, __tool_batch, ...requestedParams } = entry.parameters;
    const toolRequest = typeof tool_request === 'string' ? tool_request : undefined;
    const toolNote = typeof tool_note === 'string' ? tool_note : undefined;
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
      toolEntryId: args.toolEntryId,
      params: requestedParams,
      approvalGranted: true,
      plannerFollowup: { mode: 'continue' },
      // The batch already continued once; this re-reaction is user-intended.
      forceContinuation: true,
      ...(toolRequest ? { toolRequest } : {}),
      ...(toolNote ? { toolNote } : {}),
      ...(toolBatch ? { toolBatch } : {}),
      ...(toolOverrides ? { toolOverrides } : {}),
    };

    scope.spawn(async () => {
      await this.executeTool({
        input,
        tool,
        parsedParams,
        parsedRules,
        entries,
        scope,
        llm,
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

    const toolBatch = parseToolBatch((entry.parameters as Record<string, unknown>).__tool_batch);
    this.memberResolved({
      input: {
        conversationId: args.conversationId,
        agentId: args.agentId,
        toolName: entry.toolId,
        toolEntryId: entry.id,
        params: {},
        plannerFollowup: { mode: 'continue' },
        ...(toolBatch ? { toolBatch } : {}),
      },
      scope,
      llm,
    });
  }

  /** Mark the invocation's pre-created entry terminally failed (visible, retriable per envelope). */
  private async failEntry(input: RunToolInput, reason: string): Promise<void> {
    const startedAt = new Date();
    const envelope: ToolEnvelope = {
      ok: false,
      toolId: input.toolName,
      output: null,
      error: reason,
      permission_state: 'forbid',
      timing: { started_at: startedAt.toISOString(), finished_at: startedAt.toISOString(), elapsed_ms: 0 },
    };
    await this.chatEntries.updateToolInvocation(input.conversationId, {
      id: input.toolEntryId,
      state: 'error',
      parameters: this.toParametersPayload(input, input.params),
      result: envelope,
    });
    this.hub.publish(input.conversationId, {
      type: SseType.TOOL_INVOCATION_END,
      chatEntryId: input.toolEntryId,
      toolName: input.toolName,
      output: reason,
      ok: false,
      runContinues: false,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, input.conversationId, input.toolEntryId);
  }

  private async recordBlocked(args: {
    input: RunToolInput;
    permission: ToolPermission;
    parsedParams: unknown;
    guardrailReason?: string;
  }): Promise<{ kind: 'blocked'; toolEntryId: string }> {
    const { input, permission, parsedParams, guardrailReason } = args;
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
    // Persist the resolved params on the entry: the approval UI's edit box and
    // a later approve run read them from here.
    const parameters = this.toParametersPayload(input, parsedParams);
    const entryId = input.toolEntryId;
    await this.chatEntries.updateToolInvocation(input.conversationId, {
      id: entryId,
      state,
      parameters,
      result: envelope,
    });
    if (permission === 'ask_user') {
      this.hub.publish(input.conversationId, {
        type: SseType.TOOL_INVOCATION_START,
        chatEntryId: entryId,
        toolName: input.toolName,
        state: 'requested',
        approvalRequired: true,
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
    llm: LlmRef;
  }): Promise<RunToolResult> {
    const { input, tool, parsedParams, parsedRules, entries, scope, llm } = args;
    const startedAt = new Date();
    const startedAtMs = startedAt.getTime();
    const parameters = this.toParametersPayload(input, parsedParams);

    // The spine entry pre-exists in every path (planner dispatch, approval,
    // retry); the run only ever moves it `resolving/requested/error → running`.
    const entryId = input.toolEntryId;
    await this.chatEntries.updateToolInvocation(input.conversationId, { id: entryId, state: 'running', parameters });
    this.hub.publish(input.conversationId, {
      type: SseType.TOOL_INVOCATION_START,
      chatEntryId: entryId,
      toolName: input.toolName,
      state: 'running',
      approvalRequired: false,
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
    // Progress deltas also accumulate into the run's persisted log (the SSE
    // stream itself is transient); keep the TAIL when a run is chatty.
    const LOG_CAP = 200_000;
    let outputLog = '';
    try {
      scope.throwIfAborted();
      // Live progress (stdout, streamed tokens, …) → the running tool row.
      const onProgress = (delta: string): void => {
        if (!delta) return;
        outputLog = (outputLog + delta).slice(-LOG_CAP);
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
            outputLog,
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
        this.memberResolved({ input, scope, llm });
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
        .finishRun({ id: runId, status: 'done', result: envelope, outputLog, finishedAt, elapsedMs: timing.elapsed_ms })
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

    this.memberResolved({ input, scope, llm });
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
    llm: LlmRef;
  }): void {
    const { input, scope, llm } = args;
    if (input.plannerFollowup?.mode !== 'continue') return;
    const conversationId = input.conversationId;
    // Serialize checks per conversation so concurrently-settling siblings
    // evaluate one at a time against the already-persisted states. Each check
    // AWAITS its continuation's prepare insert, so the next sibling's
    // "continuation already exists?" guard reads a settled DB.
    const prev = this.continueChecks.get(conversationId) ?? Promise.resolve();
    const next = prev.then(() =>
      this.maybeContinuePlanner(input, scope, llm).catch((error) => {
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
    llm: LlmRef,
  ): Promise<void> {
    const batch = input.toolBatch;
    let anchor = input.toolEntryId;
    if (batch) {
      // Continue only once TERMINAL members reach the batch's stamped size.
      // Counting pending entries instead is racy: a member that fails before
      // its siblings' entries are inserted sees "0 pending" vacuously and
      // resumes planning while an approval is still on its way to the DB.
      const terminal = await this.chatEntries.countTerminalToolInvocationsInBatch(input.conversationId, batch.id);
      if (terminal < batch.size) return; // members still unresolved (or not yet persisted)
      // The continuation reacts to the whole batch: it anchors at the batch
      // tail (last member in chain order — a static fact since dispatch
      // pre-creates the chain), NEVER at whichever member happened to settle
      // last. Anchoring at the settling member was the historical fork bug.
      anchor = (await this.chatEntries.resolveBatchTailEntryId(input.conversationId, batch.id)) ?? input.toolEntryId;
    }
    // One continuation per completion: if the anchor already has a spine
    // child, a sibling's check (or a pre-restart run) already continued.
    // Derived from the DB, so it holds across requests and restarts. A user
    // retry bypasses it — its re-reaction is a deliberate sibling branch.
    if (!input.forceContinuation) {
      const hasContinuation = await this.chatEntries.hasSpineChild(input.conversationId, anchor);
      if (hasContinuation) return;
    }
    await this.continuePlanner(input.conversationId, anchor, scope, llm);
  }

  private async continuePlanner(
    conversationId: string,
    anchorParentId: string,
    scope: LifecycleScope,
    llm: LlmRef,
  ): Promise<void> {
    if (scope.signal.aborted) return;
    await this.thoughtProcessing.startThought({
      provider: this.plannerProvider,
      conversationId,
      scope,
      anchorParentId,
      lane: 'spine',
      llm,
    });
  }

  /**
   * A member failed before run() could take over — the resolver's args didn't
   * parse, or the planner's direct args were rejected by the tool's schema.
   * Mark the member's pre-created entry terminally failed (the next planner
   * round then SEES the failed call and can self-correct, instead of silently
   * re-emitting the same call in a loop) and resolve the batch member so the
   * fan-in isn't stranded.
   */
  async failDirectDispatch(args: {
    input: RunToolInput;
    reason: string;
    scope: LifecycleScope;
    llm: LlmRef;
  }): Promise<void> {
    await this.failEntry(args.input, args.reason);
    this.memberResolved({ input: args.input, scope: args.scope, llm: args.llm });
  }

  /**
   * Run the fan-in check for a member whose terminal state is ALREADY
   * persisted on its entry (run() marked it before throwing). Members whose
   * entry is still pending must go through failDirectDispatch instead — the
   * fan-in counts terminal entries against the batch size, so an unresolved
   * entry would strand the batch.
   */
  resolveFailedToolParamsMember(args: {
    conversationId: string;
    toolEntryId: string;
    toolBatch?: ToolBatchRef;
    plannerFollowup?: { mode: 'continue' | 'finalize' };
    scope: LifecycleScope;
    llm: LlmRef;
  }): void {
    this.memberResolved({
      input: {
        conversationId: args.conversationId,
        agentId: '',
        toolName: '',
        toolEntryId: args.toolEntryId,
        params: {},
        ...(args.plannerFollowup ? { plannerFollowup: args.plannerFollowup } : {}),
        ...(args.toolBatch ? { toolBatch: args.toolBatch } : {}),
      },
      scope: args.scope,
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
    if (input.toolNote) out.tool_note = input.toolNote;
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
