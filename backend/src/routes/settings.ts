import { Hono } from "hono";

import type { Runtime } from "../bootstrap/runtime.js";
import { parseJsonObjectOr400 } from "../http/parseJsonObjectOr400.js";
import {
  parseLlmProviderConnectionTestRequest,
  parseLlmProviderSettingsPutRequest,
} from "./settings.types.js";

export function createSettingsRouter(runtime: Runtime) {
  const r = new Hono();

  r.get("/llm", (c) => {
    const doc = runtime.llmProviderSettings.getDocument();
    return c.json({ providers: doc.providers });
  });

  r.get("/llm_provider", (c) => {
    return c.json(runtime.llmProviderSettings.getDocument());
  });

  r.put("/llm_provider", async (c) => {
    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;

    try {
      const body = parseLlmProviderSettingsPutRequest(parsed.value);
      return c.json(runtime.llmProviderSettings.putDocument(body));
    } catch (e) {
      const detail = e instanceof Error ? e.message : "invalid llm provider settings body";
      return c.json({ detail }, 400);
    }
  });

  r.post("/llm_provider/test_connection", async (c) => {
    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;

    let body;
    try {
      body = parseLlmProviderConnectionTestRequest(parsed.value);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "invalid test_connection body";
      return c.json({ ok: false, detail, models: [] }, 400);
    }
    const providerId = String(body.provider_id || "");
    if (!providerId) {
      return c.json({ ok: false, detail: "provider_id is required", models: [] }, 400);
    }

    const fallback = runtime.llmProviderSettings.getProviderSettings(providerId);
    const settings =
      body.settings != null && typeof body.settings === "object" && !Array.isArray(body.settings)
        ? body.settings
        : fallback;

    if (!settings) {
      return c.json({ ok: false, detail: "provider settings not found", models: [] }, 404);
    }

    const tested = await runtime.llmProviderSettings.testConnection(providerId, settings);
    if (tested.kind === "unknown_provider") {
      return c.json({ ok: false, detail: `unknown provider: ${providerId}`, models: [] }, 400);
    }
    if (tested.kind === "connectivity_failed") {
      return c.json(tested.value);
    }

    runtime.llmProviderSettings.upsertProviderModels(
      providerId,
      settings,
      tested.value.models,
    );
    return c.json(tested.value);
  });

  r.get("/model_capabilities", (c) => {
    return c.json({ models: runtime.modelCapabilities.listEffective() });
  });

  r.put("/model_capabilities/override", async (c) => {
    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;
    try {
      const models = runtime.modelCapabilities.upsertOverride(parsed.value);
      return c.json({ models });
    } catch (e) {
      const detail = e instanceof Error ? e.message : "invalid override body";
      return c.json({ detail }, 400);
    }
  });

  return r;
}
