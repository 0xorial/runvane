export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8001";

import type {
  AgentListItemResponse,
  AgentUpsertRequest,
  DeleteAgentResponse,
} from "../../../backend/src/routes/agents.types";
import {
  validateAgentResponse,
  validateDeleteAgentResponse,
  validateGetAgentsResponse,
} from "../../../backend/src/routes/agents.types";
import type {
  ChatMessageEntry,
  ConversationRow,
  GetConversationsResponse,
  PostConversationMessageAcceptedResponse,
} from "../../../backend/src/routes/conversations.types";
import {
  validateConversationRowResponse,
  validateGetConversationMessagesResponse,
  validateGetConversationsResponse,
  validatePostConversationMessageResponse,
  validatePostConversationsResponse,
} from "../../../backend/src/routes/conversations.types";
import type {
  LlmProviderConnectionTestResponse,
  LlmProviderRow,
  LlmProviderSettingsDocument,
} from "../../../backend/src/routes/settings.types";
import type { ModelCapabilityRow } from "../../../backend/src/types/modelCatalog";
import {
  validateGetLlmSettingsResponse,
  validateLlmProviderConnectionTestResponse,
  validateLlmProviderSettingsResponse,
} from "../../../backend/src/routes/settings.types";
import type { ToolCatalogItemResponse } from "../../../backend/src/routes/system.types";
import { validateGetToolsResponse } from "../../../backend/src/routes/system.types";
import type { UploadFileResponse } from "../../../backend/src/routes/uploads.types";
import { validateUploadFileResponse } from "../../../backend/src/routes/uploads.types";
import type {
  ModelPresetResponse,
  ModelPresetUpsertRequest,
  DeleteModelPresetResponse,
} from "../../../backend/src/routes/modelPresets.types";
import {
  validateDeleteModelPresetResponse,
  validateGetModelPresetsResponse,
  validateModelPresetResponse,
} from "../../../backend/src/routes/modelPresets.types";
export type { PostConversationMessageAcceptedResponse } from "../../../backend/src/routes/conversations.types";

function errDetail(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as { detail?: unknown }).detail;
    if (typeof d === "string") return d;
  }
  return fallback;
}

export async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  const data: unknown = await res.json();
  if (!res.ok) throw new Error(errDetail(data, `HTTP ${res.status}`));
  return data;
}

export async function sendJson(
  path: string,
  method: string,
  body: unknown
): Promise<unknown> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json();
  if (!res.ok) throw new Error(errDetail(data, `HTTP ${res.status}`));
  return data;
}

export async function deleteJson(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE_URL}${path}`, { method: "DELETE" });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errDetail(data, `HTTP ${res.status}`));
  return data;
}

export type PostAcceptedResult<T = unknown> = { status: number; data: T };

/** POST JSON; treats 202 as success for async chat. */
export async function postJsonAccepted(
  path: string,
  body: unknown
): Promise<PostAcceptedResult<unknown>> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) {
    throw new Error(errDetail(data, `HTTP ${res.status}`));
  }
  return { status: res.status, data };
}

export type PostConversationMessageInput = {
  message: string;
  agent_id: string;
  llm_provider_id?: string;
  llm_model?: string;
  model_preset_id?: number;
  attachment_ids?: string[];
};

export function getConversations(options?: { deletedOnly?: boolean }): Promise<GetConversationsResponse> {
  const deletedOnly = options?.deletedOnly === true;
  const path = deletedOnly ? "/api/conversations?deleted=only" : "/api/conversations";
  return getJson(path).then(validateGetConversationsResponse);
}

export function createConversation(body: { title?: string } = {}): Promise<ConversationRow> {
  return sendJson("/api/conversations", "POST", body).then(
    validatePostConversationsResponse,
  );
}

export function renameConversation(
  conversationId: string,
  body: { title?: string; group_id?: string | null; new_group_name?: string },
): Promise<ConversationRow> {
  return sendJson(`/api/conversations/${encodeURIComponent(conversationId)}`, "PUT", body).then(
    (data) => validateConversationRowResponse(data, "PUT /api/conversations/:id"),
  );
}

export function softDeleteConversation(conversationId: string): Promise<ConversationRow> {
  return deleteJson(`/api/conversations/${encodeURIComponent(conversationId)}`).then((data) =>
    validateConversationRowResponse(data, "DELETE /api/conversations/:id"),
  );
}

export function undeleteConversation(conversationId: string): Promise<ConversationRow> {
  return postJsonAccepted(`/api/conversations/${encodeURIComponent(conversationId)}/undelete`, {}).then(
    (result) => validateConversationRowResponse(result.data, "POST /api/conversations/:id/undelete"),
  );
}

export function permanentlyDeleteConversation(conversationId: string): Promise<unknown> {
  return deleteJson(`/api/conversations/${encodeURIComponent(conversationId)}/permanent`);
}

export function getConversationMessages(
  conversationId: string,
): Promise<ChatMessageEntry[]> {
  return getJson(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
  ).then(
    validateGetConversationMessagesResponse,
  );
}

export async function postConversationMessage(
  conversationId: string,
  body: PostConversationMessageInput,
): Promise<PostAcceptedResult<PostConversationMessageAcceptedResponse>> {
  const result = await postJsonAccepted(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    body,
  );
  return {
    status: result.status,
    data: validatePostConversationMessageResponse(result.data),
  };
}

export async function approveToolInvocation(
  conversationId: string,
  entryId: string,
): Promise<PostAcceptedResult<unknown>> {
  return postJsonAccepted(
    `/api/conversations/${encodeURIComponent(
      conversationId,
    )}/tool-invocations/${encodeURIComponent(entryId)}/approve`,
    {},
  );
}

export async function uploadFile(file: File): Promise<UploadFileResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/uploads`, {
    method: "POST",
    body: form,
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errDetail(data, `HTTP ${res.status}`));
  return validateUploadFileResponse(data);
}

export function getAgents(): Promise<AgentListItemResponse[]> {
  return getJson("/api/agents").then(validateGetAgentsResponse);
}

export function getLlmSettings(): Promise<{ providers: LlmProviderRow[] }> {
  return getJson("/api/settings/llm").then(validateGetLlmSettingsResponse);
}

export function getLlmProviderSettings(): Promise<LlmProviderSettingsDocument> {
  return getJson("/api/settings/llm_provider").then(
    validateLlmProviderSettingsResponse,
  );
}

export function getModelCapabilities(): Promise<{ models: ModelCapabilityRow[] }> {
  return getJson("/api/settings/model_capabilities").then((data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("GET /api/settings/model_capabilities: invalid response envelope");
    }
    const rawModels = (data as { models?: unknown }).models;
    if (!Array.isArray(rawModels)) {
      throw new Error("GET /api/settings/model_capabilities: models must be an array");
    }
    const models = rawModels.map((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(
          `GET /api/settings/model_capabilities: models[${index}] must be an object`,
        );
      }
      const row = raw as Record<string, unknown>;
      const providerId = String(row.provider_id ?? "").trim();
      const modelName = String(row.model_name ?? "").trim();
      if (!providerId || !modelName) {
        throw new Error(
          `GET /api/settings/model_capabilities: models[${index}] missing provider_id/model_name`,
        );
      }
      return raw as ModelCapabilityRow;
    });
    return { models };
  });
}

export function updateLlmProviderSettings(
  body: LlmProviderSettingsDocument,
): Promise<LlmProviderSettingsDocument> {
  return sendJson("/api/settings/llm_provider", "PUT", body).then(
    validateLlmProviderSettingsResponse,
  );
}

export function testLlmProviderConnection(body: {
  provider_id: string;
  settings?: Record<string, unknown>;
}): Promise<LlmProviderConnectionTestResponse> {
  return sendJson("/api/settings/llm_provider/test_connection", "POST", body).then(
    validateLlmProviderConnectionTestResponse,
  );
}

export function getTools(): Promise<ToolCatalogItemResponse[]> {
  return getJson("/api/tools").then(validateGetToolsResponse);
}

export function getAgentById(agentId: string): Promise<AgentListItemResponse> {
  return getJson(`/api/agents/${encodeURIComponent(agentId)}`).then(
    validateAgentResponse,
  );
}

export function updateAgentById(
  agentId: string,
  body: AgentUpsertRequest,
): Promise<AgentListItemResponse> {
  return sendJson(`/api/agents/${encodeURIComponent(agentId)}`, "PUT", body).then(
    validateAgentResponse,
  );
}

export function createAgent(
  body: AgentUpsertRequest = {},
): Promise<AgentListItemResponse> {
  return sendJson("/api/agents", "POST", body).then(validateAgentResponse);
}

export function deleteAgentById(agentId: string): Promise<DeleteAgentResponse> {
  return deleteJson(`/api/agents/${encodeURIComponent(agentId)}`).then(
    validateDeleteAgentResponse,
  );
}

export function getModelPresets(): Promise<ModelPresetResponse[]> {
  return getJson("/api/model-presets").then(validateGetModelPresetsResponse);
}

export function getModelPresetById(presetId: number): Promise<ModelPresetResponse> {
  return getJson(`/api/model-presets/${encodeURIComponent(String(presetId))}`).then(
    validateModelPresetResponse,
  );
}

export function createModelPreset(
  body: ModelPresetUpsertRequest = {},
): Promise<ModelPresetResponse> {
  return sendJson("/api/model-presets", "POST", body).then(validateModelPresetResponse);
}

export function updateModelPresetById(
  presetId: number,
  body: ModelPresetUpsertRequest,
): Promise<ModelPresetResponse> {
  return sendJson(
    `/api/model-presets/${encodeURIComponent(String(presetId))}`,
    "PUT",
    body,
  ).then(validateModelPresetResponse);
}

export function deleteModelPresetById(presetId: number): Promise<DeleteModelPresetResponse> {
  return deleteJson(`/api/model-presets/${encodeURIComponent(String(presetId))}`).then(
    validateDeleteModelPresetResponse,
  );
}

export function decideApproval(
  approvalId: string | number,
  body: { decision: "approved" | "denied"; decided_by?: string },
): Promise<unknown> {
  return sendJson(
    `/api/approvals/${encodeURIComponent(String(approvalId))}/decision`,
    "POST",
    body,
  );
}

export function cancelRunById(runId: string): Promise<unknown> {
  return sendJson(`/api/runs/${encodeURIComponent(runId)}/cancel`, "POST", {});
}

export function pauseRunById(runId: string): Promise<unknown> {
  return sendJson(`/api/runs/${encodeURIComponent(runId)}/pause`, "POST", {});
}

export function resumeRunPauseById(runId: string): Promise<unknown> {
  return sendJson(
    `/api/runs/${encodeURIComponent(runId)}/resume_pause`,
    "POST",
    {},
  );
}
