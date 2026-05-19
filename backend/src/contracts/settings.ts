import { z } from 'zod';

export {
  LlmProviderRowSchema,
  LlmConfigurationSchema,
  LlmProviderSettingsDocumentSchema,
  LlmProviderConnectionTestResponseSchema,
} from '../settings/settings.types.js';

export type {
  LlmProviderRow,
  LlmConfiguration,
  LlmProviderSettingsDocument,
  LlmProviderConnectionTestResponse,
} from '../settings/settings.types.js';

import {
  LlmProviderRowSchema,
  LlmProviderSettingsDocumentSchema,
  LlmProviderConnectionTestResponseSchema,
} from '../settings/settings.types.js';
import type {
  LlmProviderRow,
  LlmProviderSettingsDocument,
  LlmProviderConnectionTestResponse,
} from '../settings/settings.types.js';

export const LlmProviderConnectionTestRequestSchema = z.object({
  provider_id: z.string(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type LlmProviderConnectionTestRequest = z.infer<typeof LlmProviderConnectionTestRequestSchema>;

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
  const parsed = LlmProviderSettingsDocumentSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('GET/PUT /api/settings/llm_provider', parsed.error);
  return parsed.data;
}

export function validateLlmProviderConnectionTestResponse(data: unknown): LlmProviderConnectionTestResponse {
  const parsed = LlmProviderConnectionTestResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('POST /api/settings/llm_provider/test_connection', parsed.error);
  return parsed.data;
}
