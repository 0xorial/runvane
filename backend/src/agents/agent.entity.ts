import { z } from 'zod';

export const AgentToolConfigSchema = z.object({
  enabled: z.boolean().optional(),
  rules: z.record(z.string(), z.unknown()).optional(),
  guardrail: z.boolean().optional(),
  guardrail_system_prompt: z.string().optional(),
});

export const AgentGuardrailConfigSchema = z.object({
  provider_id: z.string().optional(),
  model_name: z.string().optional(),
  system_prompt: z.string().optional(),
});

export const AgentDefaultLlmConfigurationSchema = z.object({
  provider_id: z.string().optional(),
  model_name: z.string().optional(),
  tool_call_provider_id: z.string().optional(),
  tool_call_model_name: z.string().optional(),
  model_settings: z.record(z.string(), z.unknown()).optional(),
  tools: z.record(z.string(), AgentToolConfigSchema).optional(),
  guardrail: AgentGuardrailConfigSchema.optional(),
});

export const AgentModelReferenceSchema = z.object({
  provider_id: z.string(),
  model_name: z.string(),
});

export const AgentEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  system_prompt: z.string(),
  default_llm_configuration: AgentDefaultLlmConfigurationSchema.nullable(),
  default_model_preset_id: z.number().finite().nullable(),
  model_reference: AgentModelReferenceSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AgentToolConfig = z.infer<typeof AgentToolConfigSchema>;
export type AgentGuardrailConfig = z.infer<typeof AgentGuardrailConfigSchema>;
export type AgentDefaultLlmConfiguration = z.infer<typeof AgentDefaultLlmConfigurationSchema>;
export type AgentEntity = z.infer<typeof AgentEntitySchema>;
