import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishStreamFieldDelta } from '../../sse/sse-helpers.js';
import { getCompletionText, textMessage } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import type { AgentToolConfig } from '../../agents/agent.entity.js';
import { RunToolService, type ToolBatchRef } from '../../tools/run-tool.service.js';
import { DEFAULT_GUARDRAIL_PROMPT, type GuardrailConfig } from '../../contracts/guardrail.js';
import { ThoughtProcessingService } from '../thought-processing.service.js';
import type { LlmRef, ThoughtContext, ThoughtTypeProvider } from '../types.js';

const GuardrailVerdictSchema = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('approve') }),
  z.object({ verdict: z.literal('flag'), reason: z.string() }),
]);

export type GuardrailProviderInput = {
  conversationId: string;
  agentId: string;
  toolName: string;
  /** The pre-created spine entry the guardrail vets; the run updates it in place. */
  toolEntryId: string;
  params: Record<string, unknown>;
  toolRequest?: string;
  toolNote?: string;
  guardrailConfig: GuardrailConfig;
  plannerFollowup: { mode: 'continue' | 'finalize' };
  toolBatch?: ToolBatchRef;
  /** The main agent LLM — used when calling runTool after guardrail approves. */
  mainLlm: LlmRef;
  toolOverrides?: Record<string, AgentToolConfig>;
};

@Injectable()
export class GuardrailThoughtTypeProvider implements ThoughtTypeProvider<GuardrailProviderInput> {
  readonly thoughtType = 'guardrail' as const;
  readonly prepareTitle = 'Guardrail check';

  private readonly logger = new Logger(GuardrailThoughtTypeProvider.name);

  constructor(
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
    @Inject(forwardRef(() => RunToolService))
    private readonly runTool: RunToolService,
    @Inject(forwardRef(() => ThoughtProcessingService))
    private readonly thoughtProcessing: ThoughtProcessingService,
  ) {}

  /**
   * Called by ToolParamsThoughtTypeProvider.runDecision when guardrailConfig is
   * present. Starts this provider as a visible side thought anchored to the
   * tool entry it vets, keeping ThoughtProcessingService out of toolParamsProvider.
   */
  start(args: { input: GuardrailProviderInput; scope: LifecycleScope }): void {
    const { input, scope } = args;
    this.thoughtProcessing.startThought({
      provider: this,
      conversationId: input.conversationId,
      scope,
      anchorParentId: input.toolEntryId,
      lane: 'side',
      llm: { providerId: input.guardrailConfig.provider_id, model: input.guardrailConfig.model_name },
      input,
    });
  }

  runPrepare = (input: GuardrailProviderInput): LlmRequest => {
    const systemPrompt = input.guardrailConfig.system_prompt.trim() || DEFAULT_GUARDRAIL_PROMPT;
    const paramsJson = JSON.stringify(input.params, null, 2);
    const userContent =
      `Tool name: ${input.toolName}\n` +
      `Parameters:\n${paramsJson}\n\n` +
      `Respond with JSON only. Either {"verdict":"approve"} or {"verdict":"flag","reason":"<brief explanation>"}.`;
    return {
      messages: [textMessage('system', systemPrompt), textMessage('user', userContent)],
    };
  };

  onLlmEvent = (_input: GuardrailProviderInput, ctx: ThoughtContext, event: LlmStreamEvent): void => {
    if (!ctx.streamEntryId) return;
    publishStreamFieldDelta(this.hub, ctx.conversationId, ctx.streamEntryId, event);
  };

  runDecision = async (
    input: GuardrailProviderInput,
    ctx: ThoughtContext,
    completion: LlmCompletion,
    scope: LifecycleScope,
  ): Promise<void> => {
    const raw = getCompletionText(completion).trim();
    const jsonText = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let verdict: z.infer<typeof GuardrailVerdictSchema> = { verdict: 'approve' };
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonText);
    } catch {
      this.logger.warn(`guardrail: JSON parse failed for "${raw.slice(0, 200)}", defaulting to approve`);
    }
    if (parsedJson !== undefined) {
      const result = GuardrailVerdictSchema.safeParse(parsedJson);
      if (result.success) {
        verdict = result.data;
      } else {
        this.logger.warn(`guardrail: verdict shape invalid (${result.error.message}), defaulting to approve`);
      }
    }

    if (ctx.thoughtActionEntryId) {
      // Custom summary/action only — status is flipped by DecisionStep.
      await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
        summary: verdict.verdict === 'flag' ? `Flagged: ${verdict.reason ?? 'no reason'}` : 'Approved',
        action: verdict.verdict,
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtActionEntryId);
    }

    await this.runTool.run(
      {
        conversationId: input.conversationId,
        agentId: input.agentId,
        toolName: input.toolName,
        toolEntryId: input.toolEntryId,
        params: input.params,
        toolRequest: input.toolRequest,
        ...(input.toolNote ? { toolNote: input.toolNote } : {}),
        plannerFollowup: input.plannerFollowup,
        ...(verdict.verdict === 'flag' ? { guardrailFlagReason: verdict.reason } : {}),
        ...(input.toolBatch ? { toolBatch: input.toolBatch } : {}),
        ...(input.toolOverrides ? { toolOverrides: input.toolOverrides } : {}),
      },
      scope,
      input.mainLlm,
    );
  };
}
