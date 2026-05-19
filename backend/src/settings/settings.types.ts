import { z } from 'zod';
import { LlmProviderSettingSpecSchema } from '../llmProviders/provider.js';

export const LlmProviderRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  settings: z.record(z.string(), z.unknown()),
  settings_spec: z.array(LlmProviderSettingSpecSchema),
  models: z.array(z.string()),
  models_verified: z.boolean(),
});
export type LlmProviderRow = z.infer<typeof LlmProviderRowSchema>;

export const LlmConfigurationSchema = z.object({
  provider_id: z.string(),
  model_name: z.string(),
  tool_call_provider_id: z.string().optional(),
  tool_call_model_name: z.string().optional(),
  title_provider_id: z.string().optional(),
  title_model_name: z.string().optional(),
  model_settings: z.record(z.string(), z.unknown()),
});
export type LlmConfiguration = z.infer<typeof LlmConfigurationSchema>;

export const LlmProviderSettingsDocumentSchema = z.object({
  providers: z.array(LlmProviderRowSchema),
  llm_configuration: LlmConfigurationSchema,
});
export type LlmProviderSettingsDocument = z.infer<typeof LlmProviderSettingsDocumentSchema>;

export const LlmProviderConnectionTestResponseSchema = z.object({
  ok: z.boolean(),
  detail: z.string().nullable(),
  models: z.array(z.string()),
});
export type LlmProviderConnectionTestResponse = z.infer<typeof LlmProviderConnectionTestResponseSchema>;
