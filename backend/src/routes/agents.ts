import { Hono } from "hono";

import type { Runtime } from "../bootstrap/runtime.js";
import { parseJsonObjectOr400 } from "../http/parseJsonObjectOr400.js";
import {
  type AgentInputFallback,
  applyAgentInputPatch,
  parsePostAgentInput,
  parsePutAgentInput,
  toAgentResponse,
} from "./agents.types.js";

export function createAgentsRouter(runtime: Runtime) {
  const r = new Hono();

  r.get("/", (c) => {
    return c.json(runtime.agents.list().map(toAgentResponse));
  });

  r.post("/", async (c) => {
    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;

    let input;
    try {
      input = parsePostAgentInput(parsed.value);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "invalid request body";
      return c.json({ detail }, 400);
    }
    const created = runtime.agents.create(input);
    return c.json(toAgentResponse(created));
  });

  r.get("/:agentId", (c) => {
    const id = c.req.param("agentId");
    const row = runtime.agents.get(id);
    if (!row) return c.json({ detail: "agent not found" }, 404);
    return c.json(toAgentResponse(row));
  });

  r.put("/:agentId", async (c) => {
    const id = c.req.param("agentId");
    const existing = runtime.agents.get(id);
    if (!existing) return c.json({ detail: "agent not found" }, 404);

    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;

    let putInput;
    try {
      putInput = parsePutAgentInput(parsed.value);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "invalid request body";
      return c.json({ detail }, 400);
    }
    const existingFallback: AgentInputFallback = {
      name: existing.name,
      system_prompt: existing.system_prompt,
      default_llm_configuration: existing.default_llm_configuration,
      default_model_preset_id: existing.default_model_preset_id,
      model_reference: existing.model_reference,
    };
    const input = applyAgentInputPatch(existingFallback, putInput);
    const updated = runtime.agents.update(id, input);
    if (!updated) return c.json({ detail: "agent not found" }, 404);
    return c.json(toAgentResponse(updated));
  });

  r.delete("/:agentId", (c) => {
    const id = c.req.param("agentId");
    if (!runtime.agents.delete(id)) {
      return c.json({ detail: "agent not found" }, 404);
    }
    return c.json({ ok: true });
  });

  return r;
}
