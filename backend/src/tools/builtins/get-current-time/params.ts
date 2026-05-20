import { z } from 'zod';

export const GetCurrentTimeToolParamsSchema = z.object({}).strict();

export type GetCurrentTimeToolParams = z.infer<typeof GetCurrentTimeToolParamsSchema>;

/** JSON Schema for the LLM, derived from the Zod schema — single source of truth. */
export function getCurrentTimeParamsSchema(): unknown {
  return z.toJSONSchema(GetCurrentTimeToolParamsSchema);
}

export function parseGetCurrentTimeToolParams(raw: unknown): GetCurrentTimeToolParams {
  return GetCurrentTimeToolParamsSchema.parse(raw);
}
