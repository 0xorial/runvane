import { Injectable } from '@nestjs/common';
import { SseType } from '../../contracts/sse.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import { RunToolService, type AgentToolConfigInput } from '../../tools/run-tool.service.js';
import { buildToolParamsPrompt, parseToolParamsJson } from '../lib/toolParamsPrompt.js';
import type { ThoughtLifecycleEntries, ThoughtReasonLlmResult, ThoughtTypeProvider } from '../types.js';

export type ToolParamsInput = {
  conversationId: string;
  sourceEntryId: string;
  agentId: string;
  toolName: string;
  toolAiDescription: string;
  toolParamsSchema: unknown;
  toolRequest: string;
  agentToolConfig?: AgentToolConfigInput;
  plannerFollowup: { mode: 'continue' | 'finalize' };
};

@Injectable()
export class ToolParamsThoughtTypeProvider implements ThoughtTypeProvider<ToolParamsInput, 'toolParams'> {
  readonly thoughtType = 'toolParams' as const;

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: SseHubService,
    private readonly runTool: RunToolService,
  ) {}

  getLifecycleStartRequest = (input: ToolParamsInput) => ({
    conversationId: input.conversationId,
    parentId: input.sourceEntryId,
    llmRequest: this.runPrepare(input).prompt,
    kind: 'planner' as const,
    includeAction: true,
    summary: `Resolve ${input.toolName} parameters`,
  });

  runPrepare = (input: ToolParamsInput) => ({
    prompt: buildToolParamsPrompt({
      toolName: input.toolName,
      toolAiDescription: input.toolAiDescription,
      toolParamsSchema: input.toolParamsSchema,
      toolRequest: input.toolRequest,
    }),
  });

  onLlmDelta = (input: ToolParamsInput, lifecycle: ThoughtLifecycleEntries, delta: string): void => {
    if (!delta) return;
    this.hub.publish(input.conversationId, {
      type: SseType.PLANNER_LLM_STREAM,
      chatEntryId: lifecycle.streamEntryId,
      delta,
    });
  };

  runDecision = async (
    input: ToolParamsInput,
    lifecycle: ThoughtLifecycleEntries,
    llmResult: ThoughtReasonLlmResult,
    signal: AbortSignal,
  ): Promise<void> => {
    let parsedParams: Record<string, unknown>;
    try {
      parsedParams = parseToolParamsJson(llmResult.fullResponse, `tool resolver response for ${input.toolName}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.markActionFailed(lifecycle, detail);
      throw new Error(`toolParams: ${detail}`, { cause: error });
    }

    await this.markActionCompleted(lifecycle, input.toolName, parsedParams);

    await this.runTool.run(
      {
        conversationId: input.conversationId,
        sourceEntryId: input.sourceEntryId,
        agentId: input.agentId,
        toolName: input.toolName,
        params: parsedParams,
        toolRequest: input.toolRequest,
        ...(input.agentToolConfig ? { agentToolConfig: input.agentToolConfig } : {}),
        plannerFollowup: input.plannerFollowup,
      },
      signal,
    );
  };

  private async markActionCompleted(
    lifecycle: ThoughtLifecycleEntries,
    toolName: string,
    parsedParams: Record<string, unknown>,
  ): Promise<void> {
    if (!lifecycle.thoughtActionEntryId) return;
    await this.chatEntries.updateThoughtAction(lifecycle.conversationId, lifecycle.thoughtActionEntryId, {
      status: 'completed',
      summary: `Resolved parameters for ${toolName}`,
      action: 'tool_call',
      toolName,
    });
    await this.chatEntries.mergeEntryPayload(lifecycle.conversationId, lifecycle.thoughtActionEntryId, {
      resolvedParameters: parsedParams,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, lifecycle.conversationId, lifecycle.thoughtActionEntryId);
  }

  private async markActionFailed(lifecycle: ThoughtLifecycleEntries, detail: string): Promise<void> {
    if (!lifecycle.thoughtActionEntryId) return;
    await this.chatEntries.updateThoughtAction(lifecycle.conversationId, lifecycle.thoughtActionEntryId, {
      status: 'failed',
      summary: detail,
      action: 'failed',
      error: detail,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, lifecycle.conversationId, lifecycle.thoughtActionEntryId);
  }
}
