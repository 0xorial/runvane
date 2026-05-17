import { z } from 'zod';

import type { AgentDefaultLlmConfiguration, AgentEntity } from '../agents/agent.entity.js';
import type { AgentRouteResponse } from '../agents/agents.api.js';
export type { AgentRouteResponse } from '../agents/agents.api.js';

// AgentListItemResponse is the same shape as AgentRouteResponse
export type AgentListItemResponse = AgentRouteResponse;

export type AgentUpsertRequest = {
  name?: string;
  system_prompt?: string;
  default_llm_configuration?: AgentDefaultLlmConfiguration | null;
  default_model_preset_id?: number | null;
  model_reference?: { provider_id?: string; model_name?: string } | null;
};

export type DeleteAgentResponse = { ok: boolean };

export type AgentUpsertInput = {
  name: string;
  system_prompt: string;
  default_llm_configuration: AgentDefaultLlmConfiguration | null;
  default_model_preset_id: number | null;
  model_reference: { provider_id?: string; model_name?: string } | null;
};

const AgentDefaultLlmConfigurationSchema = z.object({
  provider_id: z.string().optional(),
  model_name: z.string().optional(),
  tool_call_provider_id: z.string().optional(),
  tool_call_model_name: z.string().optional(),
  model_settings: z.record(z.string(), z.unknown()).optional(),
  tools: z.record(z.string(), z.object({ enabled: z.boolean().optional(), rules: z.record(z.string(), z.unknown()).optional() }).passthrough()).optional(),
});

const AgentModelReferenceSchema = z.object({
  provider_id: z.string().optional(),
  model_name: z.string().optional(),
});

const AgentListItemResponseSchema: z.ZodType<AgentListItemResponse> = z.object({
  id: z.string(),
  name: z.string(),
  system_prompt: z.string(),
  default_llm_configuration: AgentDefaultLlmConfigurationSchema.nullable(),
  default_model_preset_id: z.number().finite().nullable(),
  model_reference: z.object({ provider_id: z.string(), model_name: z.string() }).nullable(),
  llms: z.array(z.record(z.string(), z.unknown())),
  created_at: z.string(),
  updated_at: z.string(),
});

const DeleteAgentResponseSchema: z.ZodType<DeleteAgentResponse> = z.object({
  ok: z.boolean(),
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
