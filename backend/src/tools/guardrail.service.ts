import { Injectable, Logger } from '@nestjs/common';
import { LlmProviderRegistry } from '../llmProviders/registry.js';
import { getCompletionText, textMessage } from '../llmProviders/types.js';
import { LlmProviderSettingsRepo } from '../db/repositories/llm-provider-settings.repo.js';

export type GuardrailConfig = {
  provider_id: string;
  model_name: string;
  system_prompt: string;
};

export type GuardrailInput = {
  toolName: string;
  params: unknown;
  guardrailConfig: GuardrailConfig;
};

export type GuardrailResult = { verdict: 'approve' } | { verdict: 'flag'; reason: string };

@Injectable()
export class GuardrailService {
  private readonly logger = new Logger(GuardrailService.name);

  constructor(
    private readonly providerRegistry: LlmProviderRegistry,
    private readonly providerSettingsRepo: LlmProviderSettingsRepo,
  ) {}

  async evaluate(input: GuardrailInput): Promise<GuardrailResult> {
    const { toolName, params, guardrailConfig } = input;
    const provider = this.providerRegistry.get(guardrailConfig.provider_id);
    if (!provider) {
      this.logger.warn(`guardrail: unknown provider "${guardrailConfig.provider_id}", defaulting to approve`);
      return { verdict: 'approve' };
    }

    const settings = await this.providerSettingsRepo.getProviderSettings(guardrailConfig.provider_id);
    if (!settings) {
      this.logger.warn(`guardrail: no settings for provider "${guardrailConfig.provider_id}", defaulting to approve`);
      return { verdict: 'approve' };
    }

    const paramsJson = JSON.stringify(params, null, 2);
    const userContent =
      `Tool name: ${toolName}\n` +
      `Parameters:\n${paramsJson}\n\n` +
      `Respond with JSON only. Either {"verdict":"approve"} or {"verdict":"flag","reason":"<brief explanation>"}.`;

    try {
      const completion = await provider.streamCompletion(
        settings,
        guardrailConfig.model_name,
        {
          messages: [
            textMessage('system', guardrailConfig.system_prompt),
            textMessage('user', userContent),
          ],
        },
        () => undefined,
      );

      const raw = getCompletionText(completion).trim();
      // Strip optional markdown code fences
      const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        this.logger.warn(`guardrail: JSON parse failed for response "${raw.slice(0, 200)}", defaulting to approve`);
        return { verdict: 'approve' };
      }

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (obj['verdict'] === 'approve') return { verdict: 'approve' };
        if (obj['verdict'] === 'flag' && typeof obj['reason'] === 'string') {
          return { verdict: 'flag', reason: obj['reason'] };
        }
      }

      this.logger.warn(`guardrail: unexpected verdict shape "${raw.slice(0, 200)}", defaulting to approve`);
      return { verdict: 'approve' };
    } catch (error) {
      this.logger.warn(
        `guardrail: LLM call failed (${error instanceof Error ? error.message : String(error)}), defaulting to approve`,
      );
      return { verdict: 'approve' };
    }
  }
}
