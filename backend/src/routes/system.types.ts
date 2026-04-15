import { z } from "zod";
import type { SseEventType } from "../types/sse.js";

export type TypesPingResponse = { sseTypeSample: SseEventType };
export type ToolCatalogItemResponse = {
  name: string;
  description?: string;
  ui?: boolean;
  [key: string]: unknown;
};

export function buildTypesPingResponse(): TypesPingResponse {
  const t: SseEventType = "planner_response";
  return { sseTypeSample: t };
}

export function parseSseAfterSeqHeader(rawLastEventId: string | undefined): number | null {
  const parsedLastEventId =
    typeof rawLastEventId === "string" && rawLastEventId.length > 0 ? Number(rawLastEventId) : NaN;
  return Number.isFinite(parsedLastEventId) ? Math.trunc(parsedLastEventId) : null;
}

const ToolCatalogItemResponseSchema: z.ZodType<ToolCatalogItemResponse> = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    ui: z.boolean().optional(),
  })
  .passthrough();

export function validateGetToolsResponse(data: unknown): ToolCatalogItemResponse[] {
  const parsed = z.array(ToolCatalogItemResponseSchema).safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `GET /api/tools.${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`GET /api/tools validation failed: ${details}`);
  }
  return parsed.data;
}
