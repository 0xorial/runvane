import { z } from 'zod';

const NonEmptyString = z.string().min(1);
const NullableFiniteNumber = z.number().finite().nullable();
const NullableBoolean = z.boolean().nullable();
const OptionalNullableString = z.string().min(1).nullable().optional();

export const ModelCapabilityRowSchema = z.object({
  provider_id: z.string(),
  model_name: z.string(),
  supports_image_input: z.boolean(),
  supports_file_input: z.boolean(),
  max_context_tokens: NullableFiniteNumber,
  max_output_tokens: NullableFiniteNumber,
  usd_per_1m_tokens_in: NullableFiniteNumber,
  usd_per_1m_tokens_in_cached: NullableFiniteNumber,
  usd_per_1m_tokens_out: NullableFiniteNumber,
  input_cost_per_1m: NullableFiniteNumber,
  cached_input_cost_per_1m: NullableFiniteNumber,
  output_cost_per_1m: NullableFiniteNumber,
  self_hosted: z.boolean(),
  currency: z.string(),
  source: z.union([z.literal('seed'), z.literal('discovered'), z.literal('override')]),
  overridden: z.boolean(),
});
export type ModelCapabilityRow = z.infer<typeof ModelCapabilityRowSchema>;

export const ModelCapabilityOverrideUpsertSchema = z.object({
  provider_id: NonEmptyString,
  model_name: NonEmptyString,
  supports_image_input: NullableBoolean.optional(),
  supports_file_input: NullableBoolean.optional(),
  max_context_tokens: NullableFiniteNumber.optional(),
  max_output_tokens: NullableFiniteNumber.optional(),
  usd_per_1m_tokens_in: NullableFiniteNumber.optional(),
  usd_per_1m_tokens_in_cached: NullableFiniteNumber.optional(),
  usd_per_1m_tokens_out: NullableFiniteNumber.optional(),
  input_cost_per_1m: NullableFiniteNumber.optional(),
  cached_input_cost_per_1m: NullableFiniteNumber.optional(),
  output_cost_per_1m: NullableFiniteNumber.optional(),
  self_hosted: NullableBoolean.optional(),
  currency: OptionalNullableString,
  notes: OptionalNullableString,
  updated_by: OptionalNullableString,
});
export type ModelCapabilityOverrideUpsert = z.infer<typeof ModelCapabilityOverrideUpsertSchema>;

function formatZodIssues(error: z.ZodError, context: string): Error {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${context}.${path}: ${issue.message}`;
    })
    .join('; ');
  return new Error(`${context}: invalid payload (${details})`);
}

export function validateModelCapabilityOverrideUpsert(data: unknown): ModelCapabilityOverrideUpsert {
  const parsed = ModelCapabilityOverrideUpsertSchema.safeParse(data);
  if (!parsed.success) throw formatZodIssues(parsed.error, 'PUT /api/settings/model_capabilities/override');
  return parsed.data;
}
