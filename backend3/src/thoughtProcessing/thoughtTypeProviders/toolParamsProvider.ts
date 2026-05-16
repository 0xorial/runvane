import { Injectable } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishStreamFieldDelta } from '../../sse/sse-helpers.js';
import { getCompletionText } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import { RunToolService, type AgentToolConfigInput } from '../../tools/run-tool.service.js';
import { buildToolParamsMessages, parseToolParamsJson } from '../lib/toolParamsPrompt.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';

export type ToolParamsInput = {
  conversationId: string;
  agentId: string;
  toolName: string;
  toolAiDescription: string;
  toolParamsSchema: unknown;
  toolRequest: string;
  agentToolConfig?: AgentToolConfigInput;
  plannerFollowup: { mode: 'continue' | 'finalize' };
};

@Injectable()
export class ToolParamsThoughtTypeProvider implements ThoughtTypeProvider<ToolParamsInput> {
  readonly streamEntryType = 'tool_params_llm_stream' as const;
  readonly wantsAction = true;
  readonly prepareTitle = 'Resolve tool parameters';

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: SseHubService,
    private readonly runTool: RunToolService,
  ) {}

  runPrepare = (input: ToolParamsInput): LlmRequest => ({
    messages: buildToolParamsMessages({
      toolName: input.toolName,
      toolAiDescription: input.toolAiDescription,
      toolParamsSchema: input.toolParamsSchema,
      toolRequest: input.toolRequest,
    }),
  });

  onLlmEvent = (_input: ToolParamsInput, ctx: ThoughtContext, event: LlmStreamEvent): void => {
    if (!ctx.streamEntryId) return;
    publishStreamFieldDelta(this.hub, ctx.conversationId, ctx.streamEntryId, event);
  };

  runDecision = async (
    input: ToolParamsInput,
    ctx: ThoughtContext,
    completion: LlmCompletion,
    scope: LifecycleScope,
  ): Promise<void> => {
    let parsedParams: Record<string, unknown>;
    try {
      parsedParams = parseToolParamsJson(
        getCompletionText(completion),
        input.toolName,
        `tool resolver response for ${input.toolName}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.markActionFailed(ctx, detail);
      throw new Error(`toolParams: ${detail}`, { cause: error });
    }

    await this.markActionCompleted(ctx, input.toolName, parsedParams);

    await this.runTool.run(
      {
        conversationId: input.conversationId,
        agentId: input.agentId,
        toolName: input.toolName,
        params: parsedParams,
        toolRequest: input.toolRequest,
        ...(input.agentToolConfig ? { agentToolConfig: input.agentToolConfig } : {}),
        plannerFollowup: input.plannerFollowup,
      },
      scope,
      ctx.chain,
      { providerId: ctx.llmProviderId, model: ctx.llmModel },
    );
  };

  private async markActionCompleted(
    ctx: ThoughtContext,
    toolName: string,
    parsedParams: Record<string, unknown>,
  ): Promise<void> {
    if (!ctx.thoughtActionEntryId) return;
    await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
      status: 'completed',
      summary: `Resolved parameters for ${toolName}`,
      action: 'tool_call',
      toolName,
    });
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, ctx.thoughtActionEntryId, {
      resolvedParameters: parsedParams,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtActionEntryId);
  }

  private async markActionFailed(ctx: ThoughtContext, detail: string): Promise<void> {
    if (!ctx.thoughtActionEntryId) return;
    await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
      status: 'failed',
      summary: detail,
      action: 'failed',
      error: detail,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtActionEntryId);
  }
}
