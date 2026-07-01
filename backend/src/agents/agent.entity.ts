import { z } from 'zod';
import { AgentPreinjectConfigSchema } from '../contracts/preinject.js';

export const AgentToolConfigSchema = z.object({
  /**
   * Per-agent×tool permission policy. `off` (or absent) means the tool is not
   * available to this agent; `ask`/`allow`/`custom` make it available with the
   * corresponding gate. Replaces the former `enabled` flag and per-tool
   * `rules.allowed`.
   */
  policy: z.enum(['off', 'ask', 'allow', 'custom']).optional(),
  rules: z.record(z.string(), z.unknown()).optional(),
  guardrail: z.boolean().optional(),
  guardrail_system_prompt: z.string().optional(),
  /**
   * Whether a call to this tool goes through a separate "resolve tool
   * parameters" LLM call that turns the planner's free-text tool request into
   * structured JSON args. Defaults to `true` (existing behavior); `false`
   * parses the planner's tool request directly as the params JSON, skipping
   * the extra round-trip. Overridden agent-wide by
   * `AgentConfiguration.separate_params_resolution` when that is non-null.
   */
  separate_params_resolution: z.boolean().optional(),
});

export const AgentGuardrailConfigSchema = z.object({
  provider_id: z.string().optional(),
  model_name: z.string().optional(),
  system_prompt: z.string().optional(),
});

export const AgentConfigurationSchema = z.object({
  provider_id: z.string().optional(),
  model_name: z.string().optional(),
  tool_call_provider_id: z.string().optional(),
  tool_call_model_name: z.string().optional(),
  model_settings: z.record(z.string(), z.unknown()).optional(),
  tools: z.record(z.string(), AgentToolConfigSchema).optional(),
  guardrail: AgentGuardrailConfigSchema.optional(),
  /** Absent means 'none' — no context-file preinjection (no behavior change). */
  preinject: AgentPreinjectConfigSchema.optional(),
  /**
   * Agent-wide override for every tool's `separate_params_resolution`.
   * `null`/absent defers to each tool's own flag (or the default); `true`/
   * `false` forces that behavior for all of this agent's tools regardless of
   * their individual setting.
   */
  separate_params_resolution: z.boolean().nullable().optional(),
});

export const AgentModelReferenceSchema = z.object({
  provider_id: z.string(),
  model_name: z.string(),
});

export const AgentEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  system_prompt: z.string(),
  default_llm_configuration: AgentConfigurationSchema.nullable(),
  default_model_preset_id: z.number().finite().nullable(),
  model_reference: AgentModelReferenceSchema.nullable(),
  is_default: z.boolean(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AgentToolConfig = z.infer<typeof AgentToolConfigSchema>;
export type AgentGuardrailConfig = z.infer<typeof AgentGuardrailConfigSchema>;
export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>;
export type AgentEntity = z.infer<typeof AgentEntitySchema>;
