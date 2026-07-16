import { Injectable } from '@nestjs/common';
import { LlmProviderSettingsRepo } from '../db/repositories/llm-provider-settings.repo.js';
import { ModelCapabilitiesRepo } from '../db/repositories/model-capabilities.repo.js';
import type { LlmProviderConnectionTestResponse } from './settings.types.js';
import type {
  LlmProviderConnectionTestDto,
  PutLlmProviderSettingsDto,
} from './dto/settings.dto.js';
import type { ModelCapabilityOverrideDto } from './dto/model-capability-override.dto.js';

@Injectable()
export class SettingsService {
  constructor(
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly modelCapabilities: ModelCapabilitiesRepo,
  ) {}

  async getLlmProviders() {
    const doc = await this.llmProviderSettings.getDocument();
    return { providers: doc.providers };
  }

  async getLlmProviderDocument() {
    return this.llmProviderSettings.getDocument();
  }

  async putLlmProviderDocument(body: PutLlmProviderSettingsDto) {
    return this.llmProviderSettings.putDocument({
      providers: body.providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        settings: provider.settings,
        settings_spec: [],
        models: provider.models,
        models_verified: provider.models_verified,
      })),
      llm_configuration: body.llm_configuration,
    });
  }

  async testLlmProviderConnection(body: LlmProviderConnectionTestDto): Promise<LlmProviderConnectionTestResponse> {
    const providerId = String(body.provider_id ?? '').trim();
    const fallback = await this.llmProviderSettings.getProviderSettings(providerId);
    const settings = body.settings ?? fallback;
    if (!providerId) return { ok: false, detail: 'provider_id is required', models: [] };
    if (!settings) return { ok: false, detail: 'provider settings not found', models: [] };
    const tested = await this.llmProviderSettings.testConnection(providerId, settings);
    if (tested.kind === 'unknown_provider') return { ok: false, detail: `unknown provider: ${providerId}`, models: [] };
    if (tested.kind === 'connectivity_failed') return tested.value;
    await this.llmProviderSettings.upsertProviderModels(providerId, settings, tested.value.models, tested.pricing);
    return tested.value;
  }

  async listModelCapabilities() {
    return { models: await this.modelCapabilities.listEffective() };
  }

  /** Live catalog pricing for one provider's models (composer cost estimate).
   *  Always 200 with an empty map when unavailable — pricing is best-effort. */
  async liveModelPricing(providerId: string) {
    const id = providerId.trim();
    const pricing = id ? await this.llmProviderSettings.listModelPricing(id) : null;
    return { pricing: pricing ?? {} };
  }

  async upsertModelCapabilityOverride(body: ModelCapabilityOverrideDto) {
    return { models: await this.modelCapabilities.upsertOverride(body) };
  }
}
