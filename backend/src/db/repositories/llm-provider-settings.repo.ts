import { Injectable } from '@nestjs/common';
import { LlmProviderRegistry } from '../../llmProviders/registry.js';
import type { ModelPricingPer1M, ProviderSettingsDict } from '../../llmProviders/provider.js';
import type {
  LlmConfiguration,
  LlmProviderConnectionTestResponse,
  LlmProviderRow,
  LlmProviderSettingsDocument,
} from '../../settings/settings.types.js';
import { PrismaService } from '../prisma.service.js';

type ProviderSettingRow = {
  id: string;
  label: string;
  settings_json: unknown;
  models_json: unknown;
  models_verified: number;
};

function parseObjectJson(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  return {};
}

function parseArrayJson(raw: unknown): string[] {
  if (!raw) return [];
  const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((x) => String(x)).filter((x) => x.length > 0);
}

@Injectable()
export class LlmProviderSettingsRepo {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: LlmProviderRegistry,
  ) {}

  private async ensureDefaults(): Promise<void> {
    const defaultBaseUrlById: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      grok: 'https://api.x.ai/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      lmstudio: 'http://127.0.0.1:1234/api/v1',
    };

    for (const provider of this.registry.list()) {
      await this.prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO llm_providers
         (id, label, settings_json, models_json, models_verified, created_at, updated_at)
         VALUES (?, ?, ?, '[]', 0, ?, ?)`,
        provider.id,
        provider.label,
        JSON.stringify({ base_url: defaultBaseUrlById[provider.id] ?? '' }),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    }

    await this.prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO settings (key, value_json, updated_at)
       VALUES ('llm_configuration', ?, ?)`,
      JSON.stringify({
        provider_id: 'openai',
        model_name: 'gpt-4o-mini',
        model_settings: {},
      }),
      new Date().toISOString(),
    );
  }

  async getDocument(): Promise<LlmProviderSettingsDocument> {
    await this.ensureDefaults();
    const providerRows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, label, settings_json, models_json, models_verified FROM llm_providers ORDER BY id ASC`,
    )) as ProviderSettingRow[];
    const providers: LlmProviderRow[] = providerRows.map((row) => {
      const provider = this.registry.get(row.id);
      return {
        id: row.id,
        label: row.label,
        settings: parseObjectJson(row.settings_json),
        settings_spec: provider?.getSettingsSpec() ?? [],
        models: parseArrayJson(row.models_json),
        models_verified: Number(row.models_verified ?? 0) === 1,
      };
    });
    const settingRows = (await this.prisma.$queryRawUnsafe(
      `SELECT value_json FROM settings WHERE key = 'llm_configuration'`,
    )) as Array<{ value_json: unknown }>;
    const cfgRow = settingRows[0];
    if (!cfgRow) throw new Error('missing llm_configuration setting');
    const cfgDoc = parseObjectJson(cfgRow.value_json);
    const llm_configuration: LlmConfiguration = {
      provider_id: String(cfgDoc.provider_id ?? 'openai'),
      model_name: String(cfgDoc.model_name ?? 'gpt-4o-mini'),
      ...(typeof cfgDoc.tool_call_provider_id === 'string' && cfgDoc.tool_call_provider_id
        ? { tool_call_provider_id: cfgDoc.tool_call_provider_id }
        : {}),
      ...(typeof cfgDoc.tool_call_model_name === 'string' && cfgDoc.tool_call_model_name
        ? { tool_call_model_name: cfgDoc.tool_call_model_name }
        : {}),
      ...(typeof cfgDoc.title_provider_id === 'string' && cfgDoc.title_provider_id
        ? { title_provider_id: cfgDoc.title_provider_id }
        : {}),
      ...(typeof cfgDoc.title_model_name === 'string' && cfgDoc.title_model_name
        ? { title_model_name: cfgDoc.title_model_name }
        : {}),
      model_settings:
        cfgDoc.model_settings && typeof cfgDoc.model_settings === 'object' && !Array.isArray(cfgDoc.model_settings)
          ? (cfgDoc.model_settings as Record<string, unknown>)
          : {},
    };
    return { providers, llm_configuration };
  }

  async putDocument(doc: LlmProviderSettingsDocument): Promise<LlmProviderSettingsDocument> {
    await this.ensureDefaults();
    for (const provider of doc.providers) {
      await this.prisma.$executeRawUnsafe(
        `INSERT OR REPLACE INTO llm_providers
         (id, label, settings_json, models_json, models_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM llm_providers WHERE id = ?), ?), ?)`,
        provider.id,
        provider.label,
        JSON.stringify(provider.settings),
        JSON.stringify(provider.models),
        provider.models_verified ? 1 : 0,
        provider.id,
        new Date().toISOString(),
        new Date().toISOString(),
      );
    }
    await this.prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO settings (key, value_json, updated_at)
       VALUES ('llm_configuration', ?, ?)`,
      JSON.stringify(doc.llm_configuration),
      new Date().toISOString(),
    );
    return this.getDocument();
  }

  async getProviderSettings(providerId: string): Promise<ProviderSettingsDict | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT settings_json FROM llm_providers WHERE id = ?`,
      providerId,
    )) as Array<{ settings_json: unknown }>;
    const row = rows[0];
    if (!row) return null;
    return parseObjectJson(row.settings_json);
  }

  async upsertProviderModels(providerId: string, settings: ProviderSettingsDict, models: string[]): Promise<void> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT label, created_at FROM llm_providers WHERE id = ?`,
      providerId,
    )) as Array<{ label: string | null; created_at: string | null }>;
    const existing = rows[0];
    const fallbackLabel = this.registry.get(providerId)?.label ?? providerId;
    await this.prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO llm_providers
       (id, label, settings_json, models_json, models_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, COALESCE((SELECT created_at FROM llm_providers WHERE id = ?), ?), ?)`,
      providerId,
      existing?.label ?? fallbackLabel,
      JSON.stringify(settings),
      JSON.stringify(models),
      providerId,
      existing?.created_at ?? new Date().toISOString(),
      new Date().toISOString(),
    );
  }

  /**
   * Live per-model pricing from the provider's catalog, using the stored
   * provider settings. Null when the provider is unknown, unconfigured, or
   * doesn't publish pricing — callers treat that as "no pricing", never an
   * error (this only feeds the composer's cost estimate).
   */
  async listModelPricing(providerId: string): Promise<Record<string, ModelPricingPer1M> | null> {
    const provider = this.registry.get(providerId);
    if (!provider?.listModelPricing) return null;
    const settings = await this.getProviderSettings(providerId);
    if (!settings) return null;
    try {
      return await provider.listModelPricing(settings);
    } catch {
      return null;
    }
  }

  async testConnection(
    providerId: string,
    settings: ProviderSettingsDict,
  ): Promise<
    | { kind: 'unknown_provider' }
    | { kind: 'ok'; value: LlmProviderConnectionTestResponse }
    | { kind: 'connectivity_failed'; value: LlmProviderConnectionTestResponse }
  > {
    const provider = this.registry.get(providerId);
    if (!provider) return { kind: 'unknown_provider' };
    const connectivity = await provider.checkConnectivity(settings);
    if (!connectivity.ok) {
      return {
        kind: 'connectivity_failed',
        value: { ok: false, detail: connectivity.detail, models: [] },
      };
    }
    try {
      const models = await provider.listModels(settings);
      return { kind: 'ok', value: { ok: true, detail: null, models } };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { kind: 'connectivity_failed', value: { ok: false, detail, models: [] } };
    }
  }
}
