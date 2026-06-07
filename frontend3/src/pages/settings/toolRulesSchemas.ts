import { dezerialize } from "zodex";
import type { z } from "zod";

export function buildToolRulesZodSchemas(toolCatalog: Record<string, unknown>[]): Map<string, z.ZodType> {
  const map = new Map<string, z.ZodType>();
  for (const raw of toolCatalog) {
    const name = String(raw.name ?? "").trim();
    if (!name || raw.rules_schema == null) continue;
    try {
      map.set(name, dezerialize(raw.rules_schema as never) as z.ZodType);
    } catch {
      // schema couldn't be reconstructed — editor falls back to plain JSON
    }
  }
  return map;
}
