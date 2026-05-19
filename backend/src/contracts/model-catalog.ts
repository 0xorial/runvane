import { z } from 'zod';

const NonEmptyString = z.string().min(1);
const NullableFiniteNumber = z.number().finite().nullable();
const NullableBoolean = z.boolean().nullable();
const OptionalNullableString = z
  .string()
  .transform((v) => (v.length > 0 ? v : null))
  .nullable()
  .optional();

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
  currency: z.string(),
  source: z.union([z.literal('seed'), z.literal('discovered'), z.literal('override')]),
  overridden: z.boolean(),
});
export type ModelCapabilityRow = z.infer<typeof ModelCapabilityRowSchema>;

export const SeedModelCapabilitySchema = z
  .object({
    provider_id: NonEmptyString,
    model_name: NonEmptyString,
    supports_image_input: NullableBoolean.default(false).transform((v) => v ?? false),
    supports_file_input: NullableBoolean.default(false).transform((v) => v ?? false),
    max_context_tokens: NullableFiniteNumber,
    max_output_tokens: NullableFiniteNumber,
    usd_per_1m_tokens_in: NullableFiniteNumber.optional(),
    usd_per_1m_tokens_in_cached: NullableFiniteNumber.optional(),
    usd_per_1m_tokens_out: NullableFiniteNumber.optional(),
    input_cost_per_1m: NullableFiniteNumber.optional(),
    cached_input_cost_per_1m: NullableFiniteNumber.optional(),
    output_cost_per_1m: NullableFiniteNumber.optional(),
    currency: z
      .string()
      .transform((v) => (v.length > 0 ? v : 'USD'))
      .default('USD'),
  })
  .transform((row) => {
    const inCost = row.usd_per_1m_tokens_in ?? row.input_cost_per_1m ?? null;
    const cachedInCost = row.usd_per_1m_tokens_in_cached ?? row.cached_input_cost_per_1m ?? null;
    const outCost = row.usd_per_1m_tokens_out ?? row.output_cost_per_1m ?? null;
    return {
      ...row,
      usd_per_1m_tokens_in: inCost,
      usd_per_1m_tokens_in_cached: cachedInCost,
      usd_per_1m_tokens_out: outCost,
      input_cost_per_1m: inCost,
      cached_input_cost_per_1m: cachedInCost,
      output_cost_per_1m: outCost,
    };
  });
export type SeedModelCapability = z.infer<typeof SeedModelCapabilitySchema>;

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

export function validateSeedModelCapabilities(data: unknown): SeedModelCapability[] {
  const parsed = z.array(SeedModelCapabilitySchema).safeParse(data);
  if (!parsed.success) throw formatZodIssues(parsed.error, 'model capability seed');
  return parsed.data;
}

export function validateModelCapabilityOverrideUpsert(data: unknown): ModelCapabilityOverrideUpsert {
  const parsed = ModelCapabilityOverrideUpsertSchema.safeParse(data);
  if (!parsed.success) throw formatZodIssues(parsed.error, 'PUT /api/settings/model_capabilities/override');
  return parsed.data;
}
