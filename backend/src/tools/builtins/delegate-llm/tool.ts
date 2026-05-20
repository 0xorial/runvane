import { Injectable } from '@nestjs/common';
import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolPermissionContext,
  type ToolRunContext,
} from '../../base-tool.js';
import { zerialize } from 'zodex';
import { delegateLlmParamsSchema, parseDelegateLlmParams, type DelegateLlmParams } from './params.js';
import { DelegateLlmRulesSchema, parseDelegateLlmRules, type DelegateLlmRules } from './rules.js';
import { LlmProviderRegistry } from '../../../llmProviders/registry.js';
import { LlmProviderSettingsRepo } from '../../../db/repositories/llm-provider-settings.repo.js';
import { getCompletionText, textMessage, type LlmMessage, type LlmRequest } from '../../../llmProviders/types.js';

@Injectable()
export class DelegateLlmTool extends BaseTool<DelegateLlmParams, DelegateLlmRules> {
  constructor(
    private readonly registry: LlmProviderRegistry,
    private readonly settingsRepo: LlmProviderSettingsRepo,
  ) {
    super();
  }

  getName(): string {
    return 'delegate_to_llm';
  }

  getAiDescription(): string {
    return (
      'Call another LLM (any configured provider and model) with a custom prompt and return its response. ' +
      'Useful for delegating tasks to uncensored or specialized models, getting a second opinion, ' +
      'or using a model with specific capabilities (e.g. coding, reasoning, roleplay). ' +
      'Specify the provider_id and model_name to target a particular model.'
    );
  }

  getHumanDescription(): string {
    return 'Delegate a prompt to another configured LLM provider and model.';
  }

  getParamsSchema(): unknown {
    return delegateLlmParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(DelegateLlmRulesSchema);
  }

  getDefaultRules(): DelegateLlmRules {
    return {
      allowed: 'always',
      allowed_provider_ids: [],
      max_prompt_chars: 50000,
      max_response_chars: 20000,
    };
  }

  parseParams(raw: unknown): DelegateLlmParams {
    return parseDelegateLlmParams(raw);
  }

  parseRules(raw: unknown): DelegateLlmRules {
    return parseDelegateLlmRules(raw);
  }

  evaluatePermission(context: ToolPermissionContext<DelegateLlmRules>): RuleEvaluationResult[] {
    const allowedRule = context.agentToolConfig.rules.allowed;
    const permission = allowedRule === 'always' ? 'allow' : allowedRule === 'never' ? 'forbid' : 'ask_user';
    return [
      {
        ruleName: 'allowed',
        permission,
        detail: `Rule allowed='${allowedRule}'.`,
      },
    ];
  }

  async runTool(params: DelegateLlmParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseDelegateLlmRules(context.toolRules ?? this.getDefaultRules());

    // Validate provider is in allowlist (if list is non-empty)
    if (rules.allowed_provider_ids.length > 0 && !rules.allowed_provider_ids.includes(params.provider_id)) {
      throw new Error(
        `delegate_to_llm: provider '${params.provider_id}' is not in allowed_provider_ids [${rules.allowed_provider_ids.join(', ')}]`,
      );
    }

    // Resolve provider
    const provider = this.registry.get(params.provider_id);
    if (!provider) {
      throw new Error(`delegate_to_llm: unknown provider '${params.provider_id}'`);
    }

    // Fetch provider settings
    const providerSettings = await this.settingsRepo.getProviderSettings(params.provider_id);
    if (!providerSettings) {
      throw new Error(`delegate_to_llm: no settings found for provider '${params.provider_id}'`);
    }

    // Truncate prompt
    const truncatedPrompt =
      params.prompt.length > rules.max_prompt_chars
        ? params.prompt.slice(0, rules.max_prompt_chars)
        : params.prompt;

    const prompt_chars = truncatedPrompt.length;

    // Build messages array
    const messages: LlmMessage[] = [];

    if (params.system_prompt) {
      messages.push(textMessage('system', params.system_prompt));
    }

    if (params.messages && params.messages.length > 0) {
      for (const msg of params.messages) {
        messages.push(textMessage(msg.role, msg.content));
      }
    }

    messages.push(textMessage('user', truncatedPrompt));

    const request: LlmRequest = { messages };

    // Call the provider (no streaming needed — ignore events)
    const completion = await provider.streamCompletion(providerSettings, params.model_name, request, () => {});

    const fullText = getCompletionText(completion);
    const response =
      fullText.length > rules.max_response_chars ? fullText.slice(0, rules.max_response_chars) : fullText;

    return {
      provider_id: params.provider_id,
      model_name: params.model_name,
      response,
      prompt_chars,
      response_chars: response.length,
    };
  }
}
