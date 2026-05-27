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
import type { GuardrailConfig } from '../contracts/guardrail.js';

export type RunToolInput = {
  conversationId: string;
  agentId: string;
  toolName: string;
  params: unknown;
  toolRequest?: string;
  approvalGranted?: boolean;
  plannerFollowup?: { mode: 'continue' | 'finalize' };
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
export class RunToolService {
  private readonly logger = new Logger(RunToolService.name);

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
    const toolCfg = agent?.default_llm_configuration?.tools?.[input.toolName];

    const parsedRules = tool.parseRules(toolCfg?.rules ?? tool.getDefaultRules());
    const parsedParams = tool.parseParams(input.params);
    const chainTip = chain.getTip();
    if (!chainTip) throw new Error(`runTool: chain tip is unset (conversation=${input.conversationId})`);
    const entries = await this.chatEntries.listChatEntriesFromLeaf(input.conversationId, chainTip);

    scope.throwIfAborted();
    const ruleResults = await tool.evaluatePermission({
      conversationId: input.conversationId,
      agentId: input.agentId,
      entries,
      agentToolConfig: {
        enabled: toolCfg?.enabled !== false,
        policy: 'allow',
        rules: parsedRules,
      },
    });
    const permission = mostPermissivePermission(ruleResults);

    if (permission === 'forbid' || (permission === 'ask_user' && input.approvalGranted !== true)) {
      return this.recordBlocked({ input, permission, parsedParams, chain });
    }
    // Guardrail-flagged calls block with permission='ask_user' even when the
    // permission rules said 'allow' — user must approve past the guardrail.
    if (input.guardrailFlagReason && input.approvalGranted !== true) {
      return this.recordBlocked({
        input,
        permission: 'ask_user',
        parsedParams,
        chain,
        guardrailReason: input.guardrailFlagReason,
      });
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
    const { tool_request, source: _source, ...rawParams } = entry.parameters;
    const toolRequest = typeof tool_request === 'string' ? tool_request : undefined;

    const agent = await this.agents.get(args.agentId);
    const toolCfg = agent?.default_llm_configuration?.tools?.[entry.toolId];
    const parsedRules = tool.parseRules(toolCfg?.rules ?? tool.getDefaultRules());
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
    };

    // The planner continuation hangs off the approved tool entry.
    chain.setTip(args.toolEntryId);

    scope.spawn(async () => {
      const entries = await this.chatEntries.listChatEntriesFromLeaf(args.conversationId, args.toolEntryId);
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
  }): Promise<RunToolResult> {
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
        // Continue planning so the agent can see the failure and adapt.
        if (input.plannerFollowup?.mode === 'continue') {
          this.thoughtProcessing.startThought({
            provider: this.plannerProvider,
            conversationId: input.conversationId,
            scope,
            chain,
            llm,
          });
        }
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

    if (input.plannerFollowup?.mode === 'continue') {
      scope.throwIfAborted();
      this.thoughtProcessing.startThought({
        provider: this.plannerProvider,
        conversationId: input.conversationId,
        scope,
        chain,
        llm,
      });
    }
    return { kind: 'completed', toolEntryId: entryId };
  }

  private toParametersPayload(input: RunToolInput, params: unknown): Record<string, unknown> {
    const base = params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : { raw: params };
    if (!input.toolRequest) return base;
    return { ...base, tool_request: input.toolRequest, source: 'planner_tool_request' };
  }
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
