import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

export type ModelCapabilityRow = {
  provider_id: string;
  model_name: string;
  supports_image_input: boolean;
  supports_file_input: boolean;
  max_context_tokens: number | null;
  max_output_tokens: number | null;
  input_cost_per_1m: number | null;
  cached_input_cost_per_1m: number | null;
  output_cost_per_1m: number | null;
  self_hosted: boolean;
  currency: string;
  source: 'seed' | 'discovered' | 'override';
  overridden: boolean;
};

type CapabilityDbRow = {
  provider_id: string;
  model_name: string;
  supports_image_input: number | null;
  supports_file_input: number | null;
  max_context_tokens: number | null;
  max_output_tokens: number | null;
  input_cost_per_1m: number | null;
  cached_input_cost_per_1m: number | null;
  output_cost_per_1m: number | null;
  self_hosted: number | null;
  currency: string | null;
  source: string | null;
};

type CapabilityOverrideDbRow = {
  provider_id: string;
  model_name: string;
  supports_image_input: number | null;
  supports_file_input: number | null;
  max_context_tokens: number | null;
  max_output_tokens: number | null;
  input_cost_per_1m: number | null;
  cached_input_cost_per_1m: number | null;
  output_cost_per_1m: number | null;
  self_hosted: number | null;
  currency: string | null;
};

function asBool(value: number | null | undefined): boolean {
  return Number(value) === 1;
}

@Injectable()
export class ModelCapabilitiesRepo {
  constructor(private readonly prisma: PrismaService) {}

  async listEffective(): Promise<ModelCapabilityRow[]> {
    const discovered = (await this.prisma.$queryRawUnsafe(
      `SELECT
         provider_id,
         model_name,
         supports_image_input,
         supports_file_input,
         max_context_tokens,
         max_output_tokens,
         input_cost_per_1m,
         cached_input_cost_per_1m,
         output_cost_per_1m,
         self_hosted,
         currency,
         source
       FROM model_capabilities
       ORDER BY provider_id ASC, model_name ASC`,
    )) as CapabilityDbRow[];

    const effective = new Map<string, ModelCapabilityRow>();
    for (const row of discovered) {
      effective.set(`${row.provider_id}::${row.model_name}`, {
        provider_id: row.provider_id,
        model_name: row.model_name,
        supports_image_input: asBool(row.supports_image_input),
        supports_file_input: asBool(row.supports_file_input),
        max_context_tokens: row.max_context_tokens ?? null,
        max_output_tokens: row.max_output_tokens ?? null,
        input_cost_per_1m: row.input_cost_per_1m ?? null,
        cached_input_cost_per_1m: row.cached_input_cost_per_1m ?? null,
        output_cost_per_1m: row.output_cost_per_1m ?? null,
        self_hosted: asBool(row.self_hosted),
        currency: row.currency || 'USD',
        source: row.source === 'discovered' ? 'discovered' : 'seed',
        overridden: false,
      });
    }

    const overrides = (await this.prisma.$queryRawUnsafe(
      `SELECT
         provider_id,
         model_name,
         supports_image_input,
         supports_file_input,
         max_context_tokens,
         max_output_tokens,
         input_cost_per_1m,
         cached_input_cost_per_1m,
         output_cost_per_1m,
         self_hosted,
         currency
       FROM model_capability_overrides
       ORDER BY provider_id ASC, model_name ASC`,
    )) as CapabilityOverrideDbRow[];

    for (const row of overrides) {
      const key = `${row.provider_id}::${row.model_name}`;
      const base = effective.get(key);
      effective.set(key, {
        provider_id: row.provider_id,
        model_name: row.model_name,
        supports_image_input:
          row.supports_image_input == null ? (base?.supports_image_input ?? false) : asBool(row.supports_image_input),
        supports_file_input:
          row.supports_file_input == null ? (base?.supports_file_input ?? false) : asBool(row.supports_file_input),
        max_context_tokens: row.max_context_tokens ?? base?.max_context_tokens ?? null,
        max_output_tokens: row.max_output_tokens ?? base?.max_output_tokens ?? null,
        input_cost_per_1m: row.input_cost_per_1m ?? base?.input_cost_per_1m ?? null,
        cached_input_cost_per_1m: row.cached_input_cost_per_1m ?? base?.cached_input_cost_per_1m ?? null,
        output_cost_per_1m: row.output_cost_per_1m ?? base?.output_cost_per_1m ?? null,
        self_hosted: row.self_hosted == null ? (base?.self_hosted ?? false) : asBool(row.self_hosted),
        currency: row.currency || base?.currency || 'USD',
        source: 'override',
        overridden: true,
      });
    }

    // Fold in models from configured providers (`llm_providers.models_json`) so the
    // editor lists every model a user can currently pick, not just the few that
    // happen to have overrides. Rows without overrides surface as "unpriced".
    const providers = (await this.prisma.$queryRawUnsafe(
      `SELECT id, models_json FROM llm_providers WHERE models_verified = 1`,
    )) as Array<{ id: string; models_json: unknown }>;
    for (const provider of providers) {
      const raw = provider.models_json;
      const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        const modelName = String(entry ?? '').trim();
        if (!modelName) continue;
        const key = `${provider.id}::${modelName}`;
        if (effective.has(key)) continue;
        effective.set(key, {
          provider_id: provider.id,
          model_name: modelName,
          supports_image_input: false,
          supports_file_input: false,
          max_context_tokens: null,
          max_output_tokens: null,
          input_cost_per_1m: null,
          cached_input_cost_per_1m: null,
          output_cost_per_1m: null,
          self_hosted: false,
          currency: 'USD',
          source: 'discovered',
          overridden: false,
        });
      }
    }

    return Array.from(effective.values()).sort((a, b) => {
      const providerCmp = a.provider_id.localeCompare(b.provider_id);
      if (providerCmp !== 0) return providerCmp;
      return a.model_name.localeCompare(b.model_name);
    });
  }

  async upsertOverride(input: {
    provider_id: string;
    model_name: string;
    supports_image_input?: boolean | null;
    supports_file_input?: boolean | null;
    max_context_tokens?: number | null;
    max_output_tokens?: number | null;
    input_cost_per_1m?: number | null;
    cached_input_cost_per_1m?: number | null;
    output_cost_per_1m?: number | null;
    self_hosted?: boolean | null;
    currency?: string | null;
    notes?: string | null;
    updated_by?: string | null;
  }): Promise<ModelCapabilityRow[]> {
    await this.prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO model_capability_overrides (
         provider_id, model_name, supports_image_input, supports_file_input, max_context_tokens, max_output_tokens,
         input_cost_per_1m, cached_input_cost_per_1m, output_cost_per_1m, self_hosted, currency, notes, updated_by, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.provider_id,
      input.model_name,
      input.supports_image_input == null ? null : input.supports_image_input ? 1 : 0,
      input.supports_file_input == null ? null : input.supports_file_input ? 1 : 0,
      input.max_context_tokens ?? null,
      input.max_output_tokens ?? null,
      input.input_cost_per_1m ?? null,
      input.cached_input_cost_per_1m ?? null,
      input.output_cost_per_1m ?? null,
      input.self_hosted == null ? null : input.self_hosted ? 1 : 0,
      input.currency ?? null,
      input.notes ?? null,
      input.updated_by ?? null,
      new Date().toISOString(),
    );
    return this.listEffective();
  }
}
