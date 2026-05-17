import { z } from 'zod';

// Re-export types from settings.types.ts
export type {
  LlmProviderRow,
  LlmConfiguration,
  LlmProviderSettingsDocument,
  LlmProviderConnectionTestResponse,
} from '../settings/settings.types.js';

import type {
  LlmProviderRow,
  LlmConfiguration,
  LlmProviderSettingsDocument,
  LlmProviderConnectionTestResponse,
} from '../settings/settings.types.js';

export type LlmProviderConnectionTestRequest = {
  provider_id: string;
  settings?: Record<string, unknown>;
};

const LlmProviderSettingSpecSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.union([z.literal('string'), z.literal('secret'), z.literal('url')]),
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
  tool_call_provider_id: z.string().optional(),
  tool_call_model_name: z.string().optional(),
  title_provider_id: z.string().optional(),
  title_model_name: z.string().optional(),
  model_settings: z.record(z.string(), z.unknown()),
});

const LlmProviderSettingsPutRequestSchema: z.ZodType<LlmProviderSettingsDocument> = z.object({
  providers: z.array(LlmProviderRowSchema),
  llm_configuration: LlmConfigurationSchema,
});

const LlmProviderConnectionTestResponseSchema: z.ZodType<LlmProviderConnectionTestResponse> = z.object({
  ok: z.boolean(),
  detail: z.string().nullable(),
  models: z.array(z.string()),
});

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues.map((i) => `${context}.${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
  return new Error(`${context} validation failed: ${details}`);
}

export function validateGetLlmSettingsResponse(data: unknown): { providers: LlmProviderRow[] } {
  const parsed = z.object({ providers: z.array(LlmProviderRowSchema) }).safeParse(data);
  if (!parsed.success) throw formatZodError('GET /api/settings/llm', parsed.error);
  return parsed.data;
}

export function validateLlmProviderSettingsResponse(data: unknown): LlmProviderSettingsDocument {
  const parsed = LlmProviderSettingsPutRequestSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('GET/PUT /api/settings/llm_provider', parsed.error);
  return parsed.data;
}

export function validateLlmProviderConnectionTestResponse(data: unknown): LlmProviderConnectionTestResponse {
  const parsed = LlmProviderConnectionTestResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw formatZodError('POST /api/settings/llm_provider/test_connection', parsed.error);
  }
  return parsed.data;
}
