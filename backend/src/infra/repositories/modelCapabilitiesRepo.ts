import fs from "node:fs";
import path from "node:path";

import type { SqliteDb } from "../db/client.js";
import type {
  ModelCapabilityOverrideUpsert,
  ModelCapabilityRow,
  SeedModelCapability,
} from "../../types/modelCatalog.js";
import {
  validateModelCapabilityOverrideUpsert,
  validateSeedModelCapabilities,
} from "../../types/modelCatalog.js";

const DEFAULT_SEED_DIR = path.resolve(process.cwd(), "model-catalog/models");

function boolToInt(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function asBool(value: unknown): boolean {
  return Number(value) === 1;
}

function listSeedJsonFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const out: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) out.push(fullPath);
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export class ModelCapabilitiesRepo {
  constructor(
    private readonly db: SqliteDb,
    private readonly seedDir: string = DEFAULT_SEED_DIR,
  ) {}

  private loadSeedRows(): SeedModelCapability[] {
    if (!fs.existsSync(this.seedDir)) return [];
    const files = listSeedJsonFiles(this.seedDir);
    if (files.length === 0) return [];
    const rawRows: unknown[] = [];
    for (const fullPath of files) {
      const raw = fs.readFileSync(fullPath, "utf8");
      rawRows.push(JSON.parse(raw));
    }
    return validateSeedModelCapabilities(rawRows);
  }

  listEffective(): ModelCapabilityRow[] {
    const seedRows = this.loadSeedRows();
    const seedMap = new Map<string, ModelCapabilityRow>();
    for (const row of seedRows) {
      seedMap.set(`${row.provider_id}::${row.model_name}`, {
        provider_id: row.provider_id,
        model_name: row.model_name,
        supports_image_input: row.supports_image_input,
        supports_file_input: row.supports_file_input,
        max_context_tokens: row.max_context_tokens,
        max_output_tokens: row.max_output_tokens,
        input_cost_per_1m: row.input_cost_per_1m,
        output_cost_per_1m: row.output_cost_per_1m,
        currency: row.currency || "USD",
        source: "seed",
        overridden: false,
      });
    }

    const overrides = this.db
      .prepare(
        `SELECT
           provider_id,
           model_name,
           supports_image_input,
           supports_file_input,
           max_context_tokens,
           max_output_tokens,
           input_cost_per_1m,
           output_cost_per_1m,
           currency
         FROM model_capability_overrides
         ORDER BY provider_id ASC, model_name ASC`,
      )
      .all() as Array<{
      provider_id: string;
      model_name: string;
      supports_image_input: number | null;
      supports_file_input: number | null;
      max_context_tokens: number | null;
      max_output_tokens: number | null;
      input_cost_per_1m: number | null;
      output_cost_per_1m: number | null;
      currency: string | null;
    }>;

    for (const ov of overrides) {
      const key = `${ov.provider_id}::${ov.model_name}`;
      const base = seedMap.get(key);
      seedMap.set(key, {
        provider_id: ov.provider_id,
        model_name: ov.model_name,
        supports_image_input:
          ov.supports_image_input == null
            ? (base?.supports_image_input ?? false)
            : asBool(ov.supports_image_input),
        supports_file_input:
          ov.supports_file_input == null
            ? (base?.supports_file_input ?? false)
            : asBool(ov.supports_file_input),
        max_context_tokens:
          ov.max_context_tokens != null
            ? ov.max_context_tokens
            : (base?.max_context_tokens ?? null),
        max_output_tokens:
          ov.max_output_tokens != null
            ? ov.max_output_tokens
            : (base?.max_output_tokens ?? null),
        input_cost_per_1m:
          ov.input_cost_per_1m != null
            ? ov.input_cost_per_1m
            : (base?.input_cost_per_1m ?? null),
        output_cost_per_1m:
          ov.output_cost_per_1m != null
            ? ov.output_cost_per_1m
            : (base?.output_cost_per_1m ?? null),
        currency: ov.currency || base?.currency || "USD",
        source: "override",
        overridden: true,
      });
    }

    return Array.from(seedMap.values()).sort((a, b) => {
      const pa = a.provider_id.localeCompare(b.provider_id);
      if (pa !== 0) return pa;
      return a.model_name.localeCompare(b.model_name);
    });
  }

  upsertOverride(raw: unknown): ModelCapabilityRow[] {
    const input: ModelCapabilityOverrideUpsert = validateModelCapabilityOverrideUpsert(raw);
    const now = new Date().toISOString();

    const existing = this.db
      .prepare(
        `SELECT
           supports_image_input,
           supports_file_input,
           max_context_tokens,
           max_output_tokens,
           input_cost_per_1m,
           output_cost_per_1m,
           currency,
           notes,
           updated_by
         FROM model_capability_overrides
         WHERE provider_id = ? AND model_name = ?`,
      )
      .get(input.provider_id, input.model_name) as
      | {
          supports_image_input: number | null;
          supports_file_input: number | null;
          max_context_tokens: number | null;
          max_output_tokens: number | null;
          input_cost_per_1m: number | null;
          output_cost_per_1m: number | null;
          currency: string | null;
          notes: string | null;
          updated_by: string | null;
        }
      | undefined;

    const next = {
      supports_image_input:
        input.supports_image_input !== undefined
          ? input.supports_image_input == null
            ? null
            : boolToInt(input.supports_image_input)
          : (existing?.supports_image_input ?? null),
      supports_file_input:
        input.supports_file_input !== undefined
          ? input.supports_file_input == null
            ? null
            : boolToInt(input.supports_file_input)
          : (existing?.supports_file_input ?? null),
      max_context_tokens:
        input.max_context_tokens !== undefined
          ? input.max_context_tokens
          : (existing?.max_context_tokens ?? null),
      max_output_tokens:
        input.max_output_tokens !== undefined
          ? input.max_output_tokens
          : (existing?.max_output_tokens ?? null),
      input_cost_per_1m:
        input.input_cost_per_1m !== undefined
          ? input.input_cost_per_1m
          : (existing?.input_cost_per_1m ?? null),
      output_cost_per_1m:
        input.output_cost_per_1m !== undefined
          ? input.output_cost_per_1m
          : (existing?.output_cost_per_1m ?? null),
      currency:
        input.currency !== undefined ? input.currency : (existing?.currency ?? null),
      notes: input.notes !== undefined ? input.notes : (existing?.notes ?? null),
      updated_by:
        input.updated_by !== undefined ? input.updated_by : (existing?.updated_by ?? null),
    };

    const allNull =
      next.supports_image_input == null &&
      next.supports_file_input == null &&
      next.max_context_tokens == null &&
      next.max_output_tokens == null &&
      next.input_cost_per_1m == null &&
      next.output_cost_per_1m == null &&
      next.currency == null &&
      next.notes == null &&
      next.updated_by == null;

    if (allNull) {
      this.db
        .prepare(
          `DELETE FROM model_capability_overrides
           WHERE provider_id = ? AND model_name = ?`,
        )
        .run(input.provider_id, input.model_name);
      return this.listEffective();
    }

    this.db
      .prepare(
        `INSERT OR REPLACE INTO model_capability_overrides (
           provider_id,
           model_name,
           supports_image_input,
           supports_file_input,
           max_context_tokens,
           max_output_tokens,
           input_cost_per_1m,
           output_cost_per_1m,
           currency,
           notes,
           updated_by,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.provider_id,
        input.model_name,
        next.supports_image_input,
        next.supports_file_input,
        next.max_context_tokens,
        next.max_output_tokens,
        next.input_cost_per_1m,
        next.output_cost_per_1m,
        next.currency,
        next.notes,
        next.updated_by,
        now,
      );

    return this.listEffective();
  }
}
