import { z } from "zod";
import type { LlmProviderSettingSpec } from "../llm_provider/provider.js";

export type LlmProviderRow = {
  id: string;
  label: string;
  settings: Record<string, unknown>;
  settings_spec: LlmProviderSettingSpec[];
  models: string[];
  models_verified: boolean;
};
export type LlmConfiguration = {
  provider_id: string;
  model_name: string;
  model_settings: Record<string, unknown>;
};
export type LlmProviderSettingsDocument = {
  providers: LlmProviderRow[];
  llm_configuration: LlmConfiguration;
};
export type LlmProviderSettingsPutRequest = LlmProviderSettingsDocument;
export type LlmProviderConnectionTestRequest = {
  provider_id: string;
  settings?: Record<string, unknown>;
};
export type LlmProviderConnectionTestResponse = {
  ok: boolean;
  detail: string | null;
  models: string[];
};

const LlmProviderSettingSpecSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.union([z.literal("string"), z.literal("secret"), z.literal("url")]),
  required: z.boolean(),
  placeholder: z.string().optional(),
});

const LlmProviderRowSchema: z.ZodType<LlmProviderRow> = z.object({
  id: z.string(),
  label: z.string(),
  settings: z.record(z.string(), z.unknown()),
  settings_spec: z.array(LlmProviderSettingSpecSchema),
  models: z.array(z.string()),
  models_verified: z.boolean(),
});
const LlmConfigurationSchema: z.ZodType<LlmConfiguration> = z.object({
  provider_id: z.string(),
  model_name: z.string(),
  model_settings: z.record(z.string(), z.unknown()),
});

export const LlmProviderSettingsPutRequestSchema = z.object({
  providers: z.array(LlmProviderRowSchema),
  llm_configuration: LlmConfigurationSchema,
});

const LlmProviderConnectionTestSchema: z.ZodType<LlmProviderConnectionTestRequest> = z.object({
  provider_id: z.string(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
const LlmProviderConnectionTestResponseSchema: z.ZodType<LlmProviderConnectionTestResponse> =
  z.object({
    ok: z.boolean(),
    detail: z.string().nullable(),
    models: z.array(z.string()),
  });

export function parseLlmProviderSettingsPutRequest(
  body: Record<string, unknown>
): LlmProviderSettingsPutRequest {
  return LlmProviderSettingsPutRequestSchema.parse(body);
}

export function parseLlmProviderConnectionTestRequest(
  body: Record<string, unknown>
): LlmProviderConnectionTestRequest {
  return LlmProviderConnectionTestSchema.parse(body);
}

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues
    .map((i) => `${context}.${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
  return new Error(`${context} validation failed: ${details}`);
}

export function validateGetLlmSettingsResponse(data: unknown): { providers: LlmProviderRow[] } {
  const parsed = z.object({ providers: z.array(LlmProviderRowSchema) }).safeParse(data);
  if (!parsed.success) throw formatZodError("GET /api/settings/llm", parsed.error);
  return parsed.data;
}

export function validateLlmProviderSettingsResponse(
  data: unknown
): LlmProviderSettingsDocument {
  const parsed = LlmProviderSettingsPutRequestSchema.safeParse(data);
  if (!parsed.success) throw formatZodError("GET/PUT /api/settings/llm_provider", parsed.error);
  return parsed.data;
}

export function validateLlmProviderConnectionTestResponse(
  data: unknown
): LlmProviderConnectionTestResponse {
  const parsed = LlmProviderConnectionTestResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw formatZodError("POST /api/settings/llm_provider/test_connection", parsed.error);
  }
  return parsed.data;
}
