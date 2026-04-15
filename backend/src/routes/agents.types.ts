import { z } from "zod";

import { AgentDefaultLlmConfigurationSchema, type AgentDefaultLlmConfiguration } from "../domain/agentLlmConfig.js";
import type { AgentRow } from "../infra/repositories/agentsRepo.js";

export type AgentUpsertInput = {
  name: string;
  system_prompt: string;
  default_llm_configuration: AgentDefaultLlmConfiguration | null;
  default_model_preset_id: number | null;
  model_reference: { provider_id?: string; model_name?: string } | null;
};

export type AgentInputFallback = {
  name: string;
  system_prompt: string;
  default_llm_configuration: AgentDefaultLlmConfiguration | null;
  default_model_preset_id: number | null;
  model_reference: { provider_id: string; model_name: string } | null;
};

export type AgentRouteResponse = AgentRow & {
  llms: Array<Record<string, unknown>>;
};
export type AgentListItemResponse = AgentRouteResponse;
export type AgentUpsertRequest = {
  name?: string;
  system_prompt?: string;
  default_llm_configuration?: AgentDefaultLlmConfiguration | null;
  default_model_preset_id?: number | null;
  model_reference?: { provider_id?: string; model_name?: string } | null;
};
export type DeleteAgentResponse = { ok: boolean };

const NonEmptyString = z.string().min(1);
const OptionalFiniteNumber = z.coerce.number().finite();
const AgentModelReferenceSchema = z.object({
  provider_id: z.string().optional(),
  model_name: z.string().optional(),
});
const AgentInputPatchSchema = z.object({
  name: NonEmptyString.optional(),
  system_prompt: z.string().optional(),
  default_llm_configuration: AgentDefaultLlmConfigurationSchema.nullable().optional(),
  default_model_preset_id: z.union([z.null(), OptionalFiniteNumber]).optional(),
  model_reference: AgentModelReferenceSchema.nullable().optional(),
});
const PostAgentInputSchema = z
  .object({
    name: NonEmptyString.default("New agent"),
    system_prompt: z.string().default(""),
    default_llm_configuration: AgentDefaultLlmConfigurationSchema.nullable().default(null),
    default_model_preset_id: z.union([z.null(), OptionalFiniteNumber]).default(null),
    model_reference: AgentModelReferenceSchema.nullable().default(null),
  })
  .strict();
export type AgentInputPatch = z.infer<typeof AgentInputPatchSchema>;
export type PostAgentInput = AgentUpsertInput;
export type PutAgentInput = AgentInputPatch;

function parseOptionalModelReference(raw: unknown): { provider_id?: string; model_name?: string } | null {
  if (raw == null) return null;
  const parsed = AgentModelReferenceSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    provider_id: typeof parsed.data.provider_id === "string" ? parsed.data.provider_id : undefined,
    model_name: typeof parsed.data.model_name === "string" ? parsed.data.model_name : undefined,
  };
}

export function parsePostAgentInput(body: Record<string, unknown>): PostAgentInput {
  const parsed = PostAgentInputSchema.safeParse(body);
  if (!parsed.success) {
    throw formatZodError("POST /api/agents request", parsed.error);
  }
  return parsed.data;
}

export function parsePutAgentInput(body: Record<string, unknown>): PutAgentInput {
  const parsed = AgentInputPatchSchema.safeParse(body);
  if (!parsed.success) {
    throw formatZodError("PUT /api/agents/:id request", parsed.error);
  }
  return parsed.data;
}

export function applyAgentInputPatch(fallback: AgentInputFallback, patch: AgentInputPatch): AgentUpsertInput {
  return {
    name: patch.name ?? fallback.name,
    system_prompt: patch.system_prompt ?? fallback.system_prompt,
    default_llm_configuration: patch.default_llm_configuration ?? fallback.default_llm_configuration,
    default_model_preset_id: patch.default_model_preset_id ?? fallback.default_model_preset_id,
    model_reference: parseOptionalModelReference(patch.model_reference) ?? fallback.model_reference,
  };
}

export function llmsFromAgent(
  cfg: AgentDefaultLlmConfiguration | null,
  modelRef: { provider_id: string; model_name: string } | null,
): Array<Record<string, unknown>> {
  const provider_id = String(cfg?.provider_id ?? modelRef?.provider_id ?? "");
  const model = String(cfg?.model_name ?? modelRef?.model_name ?? "");
  if (!provider_id && !model) return [];
  return [{ role: "chat", provider_id, model }];
}

export function toAgentResponse(row: AgentRow): AgentRouteResponse {
  return {
    ...row,
    llms: llmsFromAgent(row.default_llm_configuration, row.model_reference),
  };
}

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
  const details = err.issues.map((i) => `${context}.${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
  return new Error(`${context} validation failed: ${details}`);
}

export function validateGetAgentsResponse(data: unknown): AgentListItemResponse[] {
  const parsed = z.array(AgentListItemResponseSchema).safeParse(data);
  if (!parsed.success) throw formatZodError("GET /api/agents", parsed.error);
  return parsed.data;
}

export function validateAgentResponse(data: unknown): AgentListItemResponse {
  const parsed = AgentListItemResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError("GET/PUT /api/agents/:id", parsed.error);
  return parsed.data;
}

export function validateDeleteAgentResponse(data: unknown): DeleteAgentResponse {
  const parsed = DeleteAgentResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError("DELETE /api/agents/:id", parsed.error);
  return parsed.data;
}
