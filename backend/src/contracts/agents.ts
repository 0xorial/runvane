import { z } from 'zod';

import {
  AgentDefaultLlmConfigurationSchema,
  AgentModelReferenceSchema,
  type AgentDefaultLlmConfiguration,
  type AgentEntity,
} from '../agents/agent.entity.js';
import type { AgentRouteResponse } from '../agents/agents.api.js';
export type { AgentRouteResponse } from '../agents/agents.api.js';
export type { AgentDefaultLlmConfiguration, AgentEntity };

// AgentListItemResponse is the same shape as AgentRouteResponse
export type AgentListItemResponse = AgentRouteResponse;

export const AgentUpsertRequestSchema = z.object({
  name: z.string().optional(),
  system_prompt: z.string().optional(),
  default_llm_configuration: AgentDefaultLlmConfigurationSchema.nullable().optional(),
  default_model_preset_id: z.number().finite().nullable().optional(),
  model_reference: AgentModelReferenceSchema.partial().nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
});
export type AgentUpsertRequest = z.infer<typeof AgentUpsertRequestSchema>;

export const DeleteAgentResponseSchema = z.object({ ok: z.boolean() });
export type DeleteAgentResponse = z.infer<typeof DeleteAgentResponseSchema>;

export const AgentUpsertInputSchema = z.object({
  name: z.string(),
  system_prompt: z.string(),
  default_llm_configuration: AgentDefaultLlmConfigurationSchema.nullable(),
  default_model_preset_id: z.number().finite().nullable(),
  model_reference: AgentModelReferenceSchema.partial().nullable(),
});
export type AgentUpsertInput = z.infer<typeof AgentUpsertInputSchema>;

const AgentListItemResponseSchema: z.ZodType<AgentListItemResponse> = z.object({
  id: z.string(),
  name: z.string(),
  system_prompt: z.string(),
  default_llm_configuration: AgentDefaultLlmConfigurationSchema.nullable(),
  default_model_preset_id: z.number().finite().nullable(),
  model_reference: AgentModelReferenceSchema.nullable(),
  is_default: z.boolean(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  llms: z.array(z.record(z.string(), z.unknown())),
  created_at: z.string(),
  updated_at: z.string(),
});

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues.map((i) => `${context}.${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
  return new Error(`${context} validation failed: ${details}`);
}

export function validateGetAgentsResponse(data: unknown): AgentListItemResponse[] {
  const parsed = z.array(AgentListItemResponseSchema).safeParse(data);
  if (!parsed.success) throw formatZodError('GET /api/agents', parsed.error);
  return parsed.data;
}

export function validateAgentResponse(data: unknown): AgentListItemResponse {
  const parsed = AgentListItemResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('GET/PUT /api/agents/:id', parsed.error);
  return parsed.data;
}

export function validateDeleteAgentResponse(data: unknown): DeleteAgentResponse {
  const parsed = DeleteAgentResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('DELETE /api/agents/:id', parsed.error);
  return parsed.data;
}
