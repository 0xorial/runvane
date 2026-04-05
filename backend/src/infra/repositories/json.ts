export function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") {
    throw new Error("invalid json object in DB: expected string");
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}
