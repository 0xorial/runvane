import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { LifecycleScope } from '../conversations/lifecycle-scope.js';
import { SseType } from '../contracts/sse.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../sse/sse-helpers.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import { mostPermissivePermission, type ToolPermission } from './base-tool.js';
import { ToolRegistry } from './tool-registry.js';

export type AgentToolConfigInput = {
  enabled?: boolean;
  rules?: Record<string, unknown>;
};

export type RunToolInput = {
  conversationId: string;
  sourceEntryId?: string;
  agentId: string;
  toolName: string;
  params: unknown;
  toolRequest?: string;
  approvalGranted?: boolean;
  agentToolConfig?: AgentToolConfigInput;
  plannerFollowup?: { mode: 'continue' | 'finalize' };
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
    @Inject(forwardRef(() => ThoughtProcessingService))
    private readonly thoughtProcessing: ThoughtProcessingService,
  ) {}

  async run(input: RunToolInput, scope: LifecycleScope): Promise<RunToolResult> {
    if (input.sourceEntryId && !(await this.chatEntries.isEntryOnActiveLineage(input.conversationId, input.sourceEntryId))) {
      this.logger.log(`tool skipped: source entry not on active lineage (${input.conversationId}/${input.sourceEntryId})`);
      return { kind: 'skipped' };
    }
    scope.throwIfAborted();

    const tool = this.tools.get(input.toolName);
    if (!tool) {
      const reason = `Tool not found: ${input.toolName}`;
      const entryId = await this.appendErrorEntry(input, reason);
      throw new Error(reason + ` (entry=${entryId})`);
    }

    const parsedRules = tool.parseRules(input.agentToolConfig?.rules ?? tool.getDefaultRules());
    const parsedParams = tool.parseParams(input.params);
    const entries = await this.chatEntries.listChatEntries(input.conversationId);

    scope.throwIfAborted();
    const ruleResults = await tool.evaluatePermission({
      conversationId: input.conversationId,
      agentId: input.agentId,
      entries,
      agentToolConfig: {
        enabled: input.agentToolConfig?.enabled !== false,
        policy: 'allow',
        rules: parsedRules,
      },
    });
    const permission = mostPermissivePermission(ruleResults);

    const existing = await this.chatEntries.findPendingToolInvocation(input.conversationId, input.toolName, input.toolRequest);
    if (permission === 'forbid' || (permission === 'ask_user' && input.approvalGranted !== true)) {
      return this.recordBlocked({ input, permission, parsedParams, existingEntryId: existing?.id ?? null });
    }

    return this.executeTool({
      input,
      tool,
      parsedParams,
      parsedRules,
      entries,
      existingEntryId: existing?.id ?? null,
      scope,
    });
  }

  async allowAndRun(input: RunToolInput, scope: LifecycleScope): Promise<RunToolResult> {
    const pending = await this.chatEntries.findPendingToolInvocation(input.conversationId, input.toolName, input.toolRequest);
    if (!pending || pending.state !== 'requested') {
      this.logger.log(`allowAndRun skipped: no requested invocation (${input.conversationId}/${input.toolName})`);
      return { kind: 'skipped' };
    }
    return this.run({ ...input, sourceEntryId: pending.id, approvalGranted: true }, scope);
  }

  private async appendErrorEntry(input: RunToolInput, reason: string): Promise<string> {
    const startedAt = new Date();
    const envelope: ToolEnvelope = {
      ok: false,
      toolId: input.toolName,
      output: null,
      error: reason,
      permission_state: 'forbid',
      timing: { started_at: startedAt.toISOString(), finished_at: startedAt.toISOString(), elapsed_ms: 0 },
    };
    const created = await this.chatEntries.appendToolInvocation(input.conversationId, {
      toolId: input.toolName,
      state: 'error',
      parameters: this.toParametersPayload(input, input.params),
      result: envelope,
    });
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
    existingEntryId: string | null;
  }): Promise<RunToolResult> {
    const { input, permission, parsedParams, existingEntryId } = args;
    const startedAt = new Date();
    const reason = permission === 'ask_user' ? 'Tool requires user approval.' : 'Tool is forbidden by permission rules.';
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

    let entryId = existingEntryId;
    let parentId: string | null = null;
    if (entryId) {
      await this.chatEntries.updateToolInvocation(input.conversationId, { id: entryId, state, result: envelope, parameters });
    } else {
      const created = await this.chatEntries.appendToolInvocation(input.conversationId, {
        toolId: input.toolName,
        state,
        parameters,
        result: envelope,
      });
      entryId = created.id;
      parentId = created.parentId;
    }
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
    existingEntryId: string | null;
    scope: LifecycleScope;
  }): Promise<RunToolResult> {
    const { input, tool, parsedParams, parsedRules, entries, existingEntryId, scope } = args;
    const startedAt = new Date();
    const startedAtMs = startedAt.getTime();
    const parameters = this.toParametersPayload(input, parsedParams);

    let entryId = existingEntryId;
    let parentId: string | null = null;
    if (entryId) {
      await this.chatEntries.updateToolInvocation(input.conversationId, { id: entryId, state: 'running', parameters });
    } else {
      const created = await this.chatEntries.appendToolInvocation(input.conversationId, {
        toolId: input.toolName,
        state: 'running',
        parameters,
      });
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
      this.thoughtProcessing.startFullThoughtByType(input.conversationId, 'planner', scope);
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
