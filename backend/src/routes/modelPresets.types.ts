import { z } from "zod";

export type ModelPresetUpsertInput = {
  name: string;
  parameters: Record<string, unknown>;
};
export type ModelPresetResponse = {
  id: number;
  name: string;
  parameters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
export type ModelPresetUpsertRequest = {
  name?: string;
  parameters?: Record<string, unknown>;
};
export type DeleteModelPresetResponse = { ok: boolean };

const ModelPresetBodySchema = z.object({
  name: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});
const ModelPresetResponseSchema: z.ZodType<ModelPresetResponse> = z.object({
  id: z.number().finite(),
  name: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});
const DeleteModelPresetResponseSchema: z.ZodType<DeleteModelPresetResponse> = z.object({
  ok: z.boolean(),
});

export function parsePresetId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizePresetInput(
  body: Record<string, unknown>
): ModelPresetUpsertInput {
  const parsed = ModelPresetBodySchema.safeParse(body);
  if (!parsed.success) {
    return { name: "New preset", parameters: {} };
  }
  const name = String(parsed.data.name ?? "New preset") || "New preset";
  return {
    name,
    parameters: parsed.data.parameters ?? {},
  };
}

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues
    .map((i) => `${context}.${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
  return new Error(`${context} validation failed: ${details}`);
}

export function validateGetModelPresetsResponse(data: unknown): ModelPresetResponse[] {
  const parsed = z.array(ModelPresetResponseSchema).safeParse(data);
  if (!parsed.success) throw formatZodError("GET /api/model-presets", parsed.error);
  return parsed.data;
}

export function validateModelPresetResponse(data: unknown): ModelPresetResponse {
  const parsed = ModelPresetResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError("GET/PUT /api/model-presets/:id", parsed.error);
  return parsed.data;
}

export function validateDeleteModelPresetResponse(data: unknown): DeleteModelPresetResponse {
  const parsed = DeleteModelPresetResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError("DELETE /api/model-presets/:id", parsed.error);
  return parsed.data;
}
