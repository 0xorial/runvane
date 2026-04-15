import type { SqliteDb } from "../db/client.js";
import type {
  LlmConfiguration,
  LlmProviderConnectionTestResponse,
  LlmProviderRow,
  LlmProviderSettingsDocument,
  LlmProviderSettingsPutRequest,
} from "../../routes/settings.types.js";
import type { ProviderSettingsDict } from "../../llm_provider/provider.js";
import type { LlmProvider } from "../../llm_provider/provider.js";
import { LlmProviderRegistry } from "../../llm_provider/registry.js";
import { parseJsonObject } from "./json.js";

function asObject(v: unknown): Record<string, unknown> {
  if (v != null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

function optionalNonEmptyString(value: unknown): string | undefined {
  const out = String(value ?? "").trim();
  return out.length > 0 ? out : undefined;
}

function parseJsonArrayOrDefault(raw: string): string[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.map((x) => String(x)).filter((x) => x.length > 0) : [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid json array in DB: ${msg}`);
  }
}

export class LlmProviderSettingsRepo {
  constructor(
    private readonly db: SqliteDb,
    private readonly registry: LlmProviderRegistry,
  ) {
    this.ensureDefaults();
  }

  private ensureDefaults(): void {
    const now = new Date().toISOString();

    const upsertProvider = this.db.prepare(
      `INSERT OR IGNORE INTO llm_providers
       (id, label, settings_json, models_json, models_verified, created_at, updated_at)
       VALUES (?, ?, ?, '[]', 0, ?, ?)`,
    );

    for (const p of this.registry.list()) {
      const settings: Record<string, unknown> = {};
      for (const spec of p.getSettingsSpec()) {
        if (spec.key === "base_url") {
          settings.base_url =
            p.id === "grok"
              ? "https://api.x.ai/v1"
              : p.id === "openrouter"
                ? "https://openrouter.ai/api/v1"
                : p.id === "lmstudio"
                  ? "http://127.0.0.1:1234/api/v1"
                  : "https://api.openai.com/v1";
        }
      }
      upsertProvider.run(p.id, p.label, JSON.stringify(settings), now, now);

      // Backfill OpenRouter default base_url for existing rows that still have
      // the generic OpenAI URL. Preserve any user-customized base URL.
      if (p.id === "openrouter") {
        const current = this.db.prepare("SELECT settings_json FROM llm_providers WHERE id = ?").get(p.id) as
          | { settings_json?: string }
          | undefined;
        const currentSettings = current?.settings_json ? parseJsonObject(current.settings_json) : {};
        const currentBaseUrl = String(currentSettings.base_url ?? "").trim();
        if (!currentBaseUrl || currentBaseUrl === "https://api.openai.com/v1") {
          this.db
            .prepare(
              `UPDATE llm_providers
               SET settings_json = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              JSON.stringify({
                ...currentSettings,
                base_url: "https://openrouter.ai/api/v1",
              }),
              now,
              p.id,
            );
        }
      }
    }

    const hasCfg = this.db.prepare("SELECT key FROM settings WHERE key = 'llm_configuration'").get() as
      | { key?: string }
      | undefined;
    if (!hasCfg?.key) {
      this.db
        .prepare(
          `INSERT INTO settings (key, value_json, updated_at)
           VALUES ('llm_configuration', ?, ?)`,
        )
        .run(
          JSON.stringify({
            provider_id: "openai",
            model_name: "gpt-4o-mini",
            model_settings: {},
          }),
          now,
        );
    }
  }

  getDocument(): LlmProviderSettingsDocument {
    this.ensureDefaults();

    const providerRows = this.db
      .prepare(
        `SELECT id, label, settings_json, models_json, models_verified
         FROM llm_providers
         ORDER BY id ASC`,
      )
      .all() as Array<{
      id: string;
      label: string;
      settings_json: string;
      models_json: string;
      models_verified: number;
    }>;

    const providers: LlmProviderRow[] = providerRows.map((row) => {
      const provider = this.registry.get(row.id);
      return {
        id: row.id,
        label: row.label,
        settings: parseJsonObject(row.settings_json),
        settings_spec: provider?.getSettingsSpec() ?? [],
        models: parseJsonArrayOrDefault(row.models_json),
        models_verified: row.models_verified === 1,
      };
    });

    const cfgRow = this.db
      .prepare(
        `SELECT value_json
         FROM settings
         WHERE key = 'llm_configuration'`,
      )
      .get() as
      | {
          value_json: string;
        }
      | undefined;

    if (!cfgRow) {
      throw new Error("missing llm_configuration setting");
    }

    const cfgDoc = parseJsonObject(cfgRow.value_json);
    const llm_configuration: LlmConfiguration = {
      provider_id: String(cfgDoc.provider_id ?? "openai"),
      model_name: String(cfgDoc.model_name ?? "gpt-4o-mini"),
      ...(optionalNonEmptyString(cfgDoc.tool_call_provider_id)
        ? { tool_call_provider_id: optionalNonEmptyString(cfgDoc.tool_call_provider_id) }
        : {}),
      ...(optionalNonEmptyString(cfgDoc.tool_call_model_name)
        ? { tool_call_model_name: optionalNonEmptyString(cfgDoc.tool_call_model_name) }
        : {}),
      model_settings:
        cfgDoc.model_settings && typeof cfgDoc.model_settings === "object"
          ? (cfgDoc.model_settings as Record<string, unknown>)
          : {},
    };

    return { providers, llm_configuration };
  }

  putDocument(doc: LlmProviderSettingsPutRequest): LlmProviderSettingsDocument {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      for (const p of doc.providers || []) {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO llm_providers
             (id, label, settings_json, models_json, models_verified, created_at, updated_at)
             VALUES (
               ?,
               ?,
               ?,
               ?,
               ?,
               COALESCE((SELECT created_at FROM llm_providers WHERE id = ?), ?),
               ?
             )`,
          )
          .run(
            p.id,
            p.label,
            JSON.stringify(asObject(p.settings)),
            JSON.stringify(Array.isArray(p.models) ? p.models : []),
            p.models_verified ? 1 : 0,
            p.id,
            now,
            now,
          );
      }

      const cfg = doc.llm_configuration;
      this.db
        .prepare(
          `INSERT OR REPLACE INTO settings (key, value_json, updated_at)
           VALUES ('llm_configuration', ?, ?)`,
        )
        .run(
          JSON.stringify({
            provider_id: String(cfg.provider_id || "openai"),
            model_name: String(cfg.model_name || "gpt-4o-mini"),
            tool_call_provider_id: optionalNonEmptyString(cfg.tool_call_provider_id) ?? null,
            tool_call_model_name: optionalNonEmptyString(cfg.tool_call_model_name) ?? null,
            model_settings: asObject(cfg.model_settings),
          }),
          now,
        );
    });

    tx();
    return this.getDocument();
  }

  getProviderSettings(providerId: string): ProviderSettingsDict | null {
    const row = this.db.prepare("SELECT settings_json FROM llm_providers WHERE id = ?").get(providerId) as
      | { settings_json?: string }
      | undefined;
    if (!row?.settings_json) return null;
    return parseJsonObject(row.settings_json);
  }

  getProvider(providerId: string): LlmProvider | null {
    return this.registry.get(providerId);
  }

  upsertProviderModels(providerId: string, settings: ProviderSettingsDict, models: string[]): void {
    const now = new Date().toISOString();
    const cur = this.db.prepare("SELECT label, created_at FROM llm_providers WHERE id = ?").get(providerId) as
      | { label?: string; created_at?: string }
      | undefined;

    const label = String(cur?.label || this.registry.get(providerId)?.label || providerId);
    const createdAt = cur?.created_at || now;

    this.db
      .prepare(
        `INSERT OR REPLACE INTO llm_providers
         (id, label, settings_json, models_json, models_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(providerId, label, JSON.stringify(asObject(settings)), JSON.stringify(models), createdAt, now);
  }

  async testConnection(
    providerId: string,
    settings: ProviderSettingsDict,
  ): Promise<
    | { kind: "unknown_provider" }
    | { kind: "ok"; value: LlmProviderConnectionTestResponse }
    | { kind: "connectivity_failed"; value: LlmProviderConnectionTestResponse }
  > {
    const provider = this.registry.get(providerId);
    if (!provider) return { kind: "unknown_provider" };

    const connectivity = await provider.checkConnectivity(settings);
    if (!connectivity.ok) {
      return {
        kind: "connectivity_failed",
        value: { ok: false, detail: connectivity.detail, models: [] },
      };
    }

    try {
      const models = await provider.listModels(settings);
      return {
        kind: "ok",
        value: { ok: true, detail: null, models },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        kind: "connectivity_failed",
        value: { ok: false, detail: `models fetch failed: ${msg}`, models: [] },
      };
    }
  }
}
