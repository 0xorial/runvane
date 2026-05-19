import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ChatChain } from '../../conversations/chat-chain.js';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishStreamFieldDelta } from '../../sse/sse-helpers.js';
import { getCompletionText, textMessage } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import { RunToolService, type AgentToolConfigInput } from '../../tools/run-tool.service.js';
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
  params: Record<string, unknown>;
  toolRequest?: string;
  agentToolConfig?: AgentToolConfigInput;
  guardrailConfig: GuardrailConfig;
  plannerFollowup: { mode: 'continue' | 'finalize' };
  /** The main agent LLM — used when calling runTool after guardrail approves. */
  mainLlm: LlmRef;
};

@Injectable()
export class GuardrailThoughtTypeProvider implements ThoughtTypeProvider<GuardrailProviderInput> {
  readonly streamEntryType = 'guardrail_llm_stream' as const;
  readonly prepareTitle = 'Guardrail check';

  private readonly logger = new Logger(GuardrailThoughtTypeProvider.name);

  constructor(
    private readonly hub: SseHubService,
    @Inject(forwardRef(() => RunToolService))
    private readonly runTool: RunToolService,
    @Inject(forwardRef(() => ThoughtProcessingService))
    private readonly thoughtProcessing: ThoughtProcessingService,
  ) {}

  /**
   * Called by ToolParamsThoughtTypeProvider.runDecision when guardrailConfig is
   * present. Starts this provider as a visible thought in the chain using the
   * guardrail LLM, keeping ThoughtProcessingService out of toolParamsProvider.
   */
  start(args: {
    input: GuardrailProviderInput;
    scope: LifecycleScope;
    chain: ChatChain;
  }): void {
    const { input, scope, chain } = args;
    this.thoughtProcessing.startThought({
      provider: this,
      conversationId: input.conversationId,
      scope,
      chain,
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
      messages: [
        textMessage('system', systemPrompt),
        textMessage('user', userContent),
      ],
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
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

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

    await this.runTool.run(
      {
        conversationId: input.conversationId,
        agentId: input.agentId,
        toolName: input.toolName,
        params: input.params,
        toolRequest: input.toolRequest,
        agentToolConfig: input.agentToolConfig,
        plannerFollowup: input.plannerFollowup,
        decidingThoughtId: ctx.thoughtId,
        ...(verdict.verdict === 'flag' ? { guardrailFlagReason: verdict.reason } : {}),
      },
      scope,
      ctx.chain,
      input.mainLlm,
    );
  };
}
