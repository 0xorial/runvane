import { Hono } from "hono";

import type { Runtime } from "../bootstrap/runtime.js";
import { parseJsonObjectOr400 } from "../http/parseJsonObjectOr400.js";
import { normalizePresetInput, parsePresetId } from "./modelPresets.types.js";

export function createModelPresetsRouter(runtime: Runtime) {
  const r = new Hono();

  r.get("/", (c) => c.json(runtime.modelPresets.list()));

  r.post("/", async (c) => {
    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;
    const created = runtime.modelPresets.create(normalizePresetInput(parsed.value));
    return c.json(created);
  });

  r.get("/:presetId", (c) => {
    const id = parsePresetId(c.req.param("presetId"));
    if (id == null) return c.json({ detail: "invalid preset id" }, 400);
    const row = runtime.modelPresets.get(id);
    if (!row) return c.json({ detail: "model preset not found" }, 404);
    return c.json(row);
  });

  r.put("/:presetId", async (c) => {
    const id = parsePresetId(c.req.param("presetId"));
    if (id == null) return c.json({ detail: "invalid preset id" }, 400);

    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;

    const updated = runtime.modelPresets.update(id, normalizePresetInput(parsed.value));
    if (!updated) return c.json({ detail: "model preset not found" }, 404);
    return c.json(updated);
  });

  r.delete("/:presetId", (c) => {
    const id = parsePresetId(c.req.param("presetId"));
    if (id == null) return c.json({ detail: "invalid preset id" }, 400);
    const result = runtime.modelPresets.delete(id);
    if (result === "not_found") return c.json({ detail: "model preset not found" }, 404);
    return c.json({ ok: true });
  });

  return r;
}
