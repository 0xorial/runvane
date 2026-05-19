import { z } from 'zod';

export const ModelPresetUpsertInputSchema = z.object({
  name: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});
export type ModelPresetUpsertInput = z.infer<typeof ModelPresetUpsertInputSchema>;

export const ModelPresetResponseSchema = z.object({
  id: z.number().finite(),
  name: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ModelPresetResponse = z.infer<typeof ModelPresetResponseSchema>;

export const ModelPresetUpsertRequestSchema = z.object({
  name: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});
export type ModelPresetUpsertRequest = z.infer<typeof ModelPresetUpsertRequestSchema>;

export const DeleteModelPresetResponseSchema = z.object({ ok: z.boolean() });
export type DeleteModelPresetResponse = z.infer<typeof DeleteModelPresetResponseSchema>;

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues.map((i) => `${context}.${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
  return new Error(`${context} validation failed: ${details}`);
}

export function validateGetModelPresetsResponse(data: unknown): ModelPresetResponse[] {
  const parsed = z.array(ModelPresetResponseSchema).safeParse(data);
  if (!parsed.success) throw formatZodError('GET /api/model-presets', parsed.error);
  return parsed.data;
}

export function validateModelPresetResponse(data: unknown): ModelPresetResponse {
  const parsed = ModelPresetResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('GET/PUT /api/model-presets/:id', parsed.error);
  return parsed.data;
}

export function validateDeleteModelPresetResponse(data: unknown): DeleteModelPresetResponse {
  const parsed = DeleteModelPresetResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('DELETE /api/model-presets/:id', parsed.error);
  return parsed.data;
}
