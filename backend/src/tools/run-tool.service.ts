import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ChatChain } from '../conversations/chat-chain.js';
import { LifecycleScope } from '../conversations/lifecycle-scope.js';
import { SseType } from '../contracts/sse.js';
import { AgentsRepo } from '../db/repositories/agents.repo.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../sse/sse-helpers.js';
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
    const entries = await this.chatEntries.listChatEntries(input.conversationId);

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
  }): Promise<RunToolResult> {
    const { input, tool, parsedParams, parsedRules, entries, scope, chain, llm } = args;
    const startedAt = new Date();
    const startedAtMs = startedAt.getTime();
    const parameters = this.toParametersPayload(input, parsedParams);

    const created = await chain.append(input.decidingThoughtId ?? null, (p) =>
      this.chatEntries.appendToolInvocation(input.conversationId, {
        toolId: input.toolName,
        state: 'running',
        parameters,
        parentId: p,
      }),
    );
    const entryId = created.id;
    const parentId = created.parentId;
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

    scope.throwIfAborted();
    const output = await tool.runTool(parsedParams, {
      conversationId: input.conversationId,
      agentId: input.agentId,
      entries,
      toolRules: parsedRules,
    });
    scope.throwIfAborted();

    const finishedAt = new Date();
    const envelope: ToolEnvelope = {
      ok: true,
      toolId: input.toolName,
      output,
      error: null,
      permission_state: 'allow',
      timing: {
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        elapsed_ms: Math.max(0, finishedAt.getTime() - startedAtMs),
      },
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
