import type { SqliteDb } from "../db/client.js";
import type { AgentDefaultLlmConfiguration } from "../../domain/agentLlmConfig.js";
import { parseAgentDefaultLlmConfigurationStrict } from "../../domain/agentLlmConfig.js";

export type AgentRow = {
  id: string;
  name: string;
  system_prompt: string;
  default_llm_configuration: AgentDefaultLlmConfiguration | null;
  default_model_preset_id: number | null;
  model_reference: { provider_id: string; model_name: string } | null;
  created_at: string;
  updated_at: string;
};

type AgentDbRow = {
  id: string;
  name: string;
  system_prompt: string | null;
  default_llm_configuration_json: string | null;
  default_model_preset_id: number | null;
  model_provider_id: string | null;
  model_name: string | null;
  created_at: string;
  updated_at: string;
};

function parseAgentConfigJson(raw: string, rowId: string): unknown {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`agents:${rowId} invalid default_llm_configuration: expected object`);
  }
  return parsed;
}

function toRow(row: AgentDbRow): AgentRow {
  const providerId = String(row.model_provider_id ?? "").trim();
  const modelName = String(row.model_name ?? "").trim();
  return {
    id: row.id,
    name: row.name,
    system_prompt: String(row.system_prompt ?? ""),
    default_llm_configuration:
      row.default_llm_configuration_json != null
        ? parseAgentDefaultLlmConfigurationStrict(
            parseAgentConfigJson(row.default_llm_configuration_json, row.id),
            `agents:${row.id}`,
          )
        : null,
    default_model_preset_id:
      typeof row.default_model_preset_id === "number"
        ? row.default_model_preset_id
        : null,
    model_reference:
      providerId || modelName
        ? { provider_id: providerId, model_name: modelName }
        : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class AgentsRepo {
  constructor(private readonly db: SqliteDb) {}

  list(): AgentRow[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           name,
           system_prompt,
           default_llm_configuration_json,
           default_model_preset_id,
           model_provider_id,
           model_name,
           created_at,
           updated_at
         FROM agents
         ORDER BY updated_at DESC`,
      )
      .all() as AgentDbRow[];
    return rows.map(toRow);
  }

  get(id: string): AgentRow | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           name,
           system_prompt,
           default_llm_configuration_json,
           default_model_preset_id,
           model_provider_id,
           model_name,
           created_at,
           updated_at
         FROM agents
         WHERE id = ?`,
      )
      .get(id) as AgentDbRow | undefined;
    return row ? toRow(row) : null;
  }

  create(input: {
    name: string;
    system_prompt?: string;
    default_llm_configuration?: AgentDefaultLlmConfiguration | null;
    default_model_preset_id?: number | null;
    model_reference?: { provider_id?: string; model_name?: string } | null;
  }): AgentRow {
    const now = new Date().toISOString();
    const cfg = parseAgentDefaultLlmConfigurationStrict(
      input.default_llm_configuration,
      "agents.create",
    );
    const modelRefProviderId = String(input.model_reference?.provider_id ?? "").trim();
    const modelRefModelName = String(input.model_reference?.model_name ?? "").trim();
    const row: AgentRow = {
      id: crypto.randomUUID(),
      name: input.name,
      system_prompt: typeof input.system_prompt === "string" ? input.system_prompt : "",
      default_llm_configuration: cfg,
      default_model_preset_id:
        typeof input.default_model_preset_id === "number"
          ? input.default_model_preset_id
          : null,
      model_reference:
        modelRefProviderId || modelRefModelName
          ? { provider_id: modelRefProviderId, model_name: modelRefModelName }
          : null,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO agents (
           id,
           name,
           system_prompt,
           default_llm_configuration_json,
           default_model_preset_id,
           model_provider_id,
           model_name,
           created_at,
           updated_at
         )
         VALUES (
           @id,
           @name,
           @system_prompt,
           @default_llm_configuration_json,
           @default_model_preset_id,
           @model_provider_id,
           @model_name,
           @created_at,
           @updated_at
         )`,
      )
      .run({
        id: row.id,
        name: row.name,
        system_prompt: row.system_prompt,
        default_llm_configuration_json: row.default_llm_configuration
          ? JSON.stringify(row.default_llm_configuration)
          : null,
        default_model_preset_id: row.default_model_preset_id,
        model_provider_id: row.model_reference?.provider_id ?? null,
        model_name: row.model_reference?.model_name ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    return row;
  }

  update(
    id: string,
    input: {
      name: string;
      system_prompt?: string;
      default_llm_configuration?: AgentDefaultLlmConfiguration | null;
      default_model_preset_id?: number | null;
      model_reference?: { provider_id?: string; model_name?: string } | null;
    },
  ): AgentRow | null {
    const now = new Date().toISOString();
    const exists = this.db
      .prepare("SELECT id FROM agents WHERE id = ?")
      .get(id) as { id?: string } | undefined;
    if (!exists?.id) return null;
    const cfg = parseAgentDefaultLlmConfigurationStrict(
      input.default_llm_configuration,
      `agents.update:${id}`,
    );
    const modelRefProviderId = String(input.model_reference?.provider_id ?? "").trim();
    const modelRefModelName = String(input.model_reference?.model_name ?? "").trim();
    const defaultModelPresetId =
      typeof input.default_model_preset_id === "number"
        ? input.default_model_preset_id
        : null;
    this.db
      .prepare(
        `UPDATE agents
         SET name = @name,
             system_prompt = @system_prompt,
             default_llm_configuration_json = @default_llm_configuration_json,
             default_model_preset_id = @default_model_preset_id,
             model_provider_id = @model_provider_id,
             model_name = @model_name,
             updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({
        id,
        name: input.name,
        system_prompt: typeof input.system_prompt === "string" ? input.system_prompt : "",
        default_llm_configuration_json: cfg ? JSON.stringify(cfg) : null,
        default_model_preset_id: defaultModelPresetId,
        model_provider_id: modelRefProviderId || null,
        model_name: modelRefModelName || null,
        updated_at: now,
      });
    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
