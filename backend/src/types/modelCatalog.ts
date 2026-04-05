import { z } from "zod";

export type ModelCapabilityRow = {
  provider_id: string;
  model_name: string;
  supports_image_input: boolean;
  supports_file_input: boolean;
  max_context_tokens: number | null;
  max_output_tokens: number | null;
  input_cost_per_1m: number | null;
  output_cost_per_1m: number | null;
  currency: string;
  source: "seed" | "override";
  overridden: boolean;
};

export type SeedModelCapability = {
  provider_id: string;
  model_name: string;
  supports_image_input: boolean;
  supports_file_input: boolean;
  max_context_tokens: number | null;
  max_output_tokens: number | null;
  input_cost_per_1m: number | null;
  output_cost_per_1m: number | null;
  currency: string;
};

export type ModelCapabilityOverrideUpsert = {
  provider_id: string;
  model_name: string;
  supports_image_input?: boolean | null;
  supports_file_input?: boolean | null;
  max_context_tokens?: number | null;
  max_output_tokens?: number | null;
  input_cost_per_1m?: number | null;
  output_cost_per_1m?: number | null;
  currency?: string | null;
  notes?: string | null;
  updated_by?: string | null;
};

const NonEmptyString = z.string().min(1);
const NullableFiniteNumber = z.number().finite().nullable();
const NullableBoolean = z.boolean().nullable();
const OptionalNullableString = z
  .string()
  .transform((v) => (v.length > 0 ? v : null))
  .nullable()
  .optional();

export const SeedModelCapabilitySchema: z.ZodType<SeedModelCapability> = z.object({
  provider_id: NonEmptyString,
  model_name: NonEmptyString,
  supports_image_input: NullableBoolean.default(false).transform((v) => v ?? false),
  supports_file_input: NullableBoolean.default(false).transform((v) => v ?? false),
  max_context_tokens: NullableFiniteNumber,
  max_output_tokens: NullableFiniteNumber,
  input_cost_per_1m: NullableFiniteNumber,
  output_cost_per_1m: NullableFiniteNumber,
  currency: z
    .string()
    .transform((v) => (v.length > 0 ? v : "USD"))
    .default("USD"),
});

export const ModelCapabilityOverrideUpsertSchema: z.ZodType<ModelCapabilityOverrideUpsert> =
  z.object({
    provider_id: NonEmptyString,
    model_name: NonEmptyString,
    supports_image_input: NullableBoolean.optional(),
    supports_file_input: NullableBoolean.optional(),
    max_context_tokens: NullableFiniteNumber.optional(),
    max_output_tokens: NullableFiniteNumber.optional(),
    input_cost_per_1m: NullableFiniteNumber.optional(),
    output_cost_per_1m: NullableFiniteNumber.optional(),
    currency: OptionalNullableString,
    notes: OptionalNullableString,
    updated_by: OptionalNullableString,
  });

function formatZodIssues(error: z.ZodError, context: string): Error {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${context}.${path}: ${issue.message}`;
    })
    .join("; ");
  return new Error(`${context}: invalid payload (${details})`);
}

export function validateSeedModelCapabilities(data: unknown): SeedModelCapability[] {
  const parsed = z.array(SeedModelCapabilitySchema).safeParse(data);
  if (!parsed.success) {
    throw formatZodIssues(parsed.error, "model capability seed");
  }
  return parsed.data;
}

export function validateModelCapabilityOverrideUpsert(
  data: unknown,
): ModelCapabilityOverrideUpsert {
  const parsed = ModelCapabilityOverrideUpsertSchema.safeParse(data);
  if (!parsed.success) {
    throw formatZodIssues(parsed.error, "PUT /api/settings/model_capabilities/override");
  }
  return parsed.data;
}
