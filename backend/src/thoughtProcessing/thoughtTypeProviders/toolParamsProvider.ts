import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishStreamFieldDelta } from '../../sse/sse-helpers.js';
import { getCompletionText } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import { RunToolService } from '../../tools/run-tool.service.js';
import type { GuardrailConfig } from '../../contracts/guardrail.js';
import { buildToolParamsMessages, parseToolParamsJson } from '../lib/toolParamsPrompt.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';
import { GuardrailThoughtTypeProvider } from './guardrailProvider.js';

export type ToolParamsInput = {
  conversationId: string;
  agentId: string;
  toolName: string;
  toolAiDescription: string;
  toolParamsSchema: unknown;
  toolRequest: string;
  plannerFollowup: { mode: 'continue' | 'finalize' };
  guardrailConfig?: GuardrailConfig;
};

@Injectable()
export class ToolParamsThoughtTypeProvider implements ThoughtTypeProvider<ToolParamsInput> {
  readonly streamEntryType = 'tool_params_llm_stream' as const;
  readonly prepareTitle = 'Resolve tool parameters';

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: SseHubService,
    @Inject(forwardRef(() => RunToolService))
    private readonly runTool: RunToolService,
    @Inject(forwardRef(() => GuardrailThoughtTypeProvider))
    private readonly guardrailProvider: GuardrailThoughtTypeProvider,
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

    const mainLlm = ctx.llm;

    if (input.guardrailConfig) {
      // Delegate to GuardrailThoughtTypeProvider so the guardrail LLM call is
      // visible as a thought entry in the chat chain.
      this.guardrailProvider.start({
        input: {
          conversationId: input.conversationId,
          agentId: input.agentId,
          toolName: input.toolName,
          params: parsedParams,
          toolRequest: input.toolRequest,
          guardrailConfig: input.guardrailConfig,
          plannerFollowup: input.plannerFollowup,
          mainLlm,
        },
        scope,
        chain: ctx.chain,
      });
      return;
    }

    await this.runTool.run(
      {
        conversationId: input.conversationId,
        agentId: input.agentId,
        toolName: input.toolName,
        params: parsedParams,
        toolRequest: input.toolRequest,
        plannerFollowup: input.plannerFollowup,
        decidingThoughtId: ctx.thoughtId,
      },
      scope,
      ctx.chain,
      mainLlm,
    );
  };

  private async markActionCompleted(
    ctx: ThoughtContext,
    toolName: string,
    parsedParams: Record<string, unknown>,
  ): Promise<void> {
    if (!ctx.thoughtActionEntryId) return;
    // Custom summary/action only — status is flipped by DecisionStep.
    await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
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
