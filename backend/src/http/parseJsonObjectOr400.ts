import type { Context } from "hono";

export type JsonObject = Record<string, unknown>;

export type ParseJsonObjectResult =
  | { ok: true; value: JsonObject }
  | { ok: false; response: Response };

export async function parseJsonObjectOr400(
  c: Context,
): Promise<ParseJsonObjectResult> {
  let raw: unknown;
  try {
    raw = await c.req.json<unknown>();
  } catch {
    return { ok: false, response: c.json({ detail: "invalid JSON body" }, 400) };
  }

  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      response: c.json({ detail: "JSON body must be an object" }, 400),
    };
  }

  return { ok: true, value: raw as JsonObject };
}
