const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
if (!apiBaseUrl) {
  throw new Error("VITE_API_BASE_URL is not configured (set via dev-ports or vite.config.ts)");
}
export const API_BASE_URL = apiBaseUrl;

import type {
  AgentListItemResponse,
  AgentUpsertRequest,
  DeleteAgentResponse,
} from "../../../backend/src/contracts/agents";
import {
  validateAgentResponse,
  validateDeleteAgentResponse,
  validateGetAgentsResponse,
} from "../../../backend/src/contracts/agents";
import type {
  ChatMessageEntry,
  ConversationRow,
  GetConversationsResponse,
  PostConversationMessageAcceptedResponse,
} from "../../../backend/src/contracts/conversations";
import {
  validateConversationRowResponse,
  validateGetConversationMessagesResponse,
  validateGetConversationsResponse,
  validatePostConversationMessageResponse,
  validatePostConversationsResponse,
} from "../../../backend/src/contracts/conversations";
import type {
  LlmProviderConnectionTestResponse,
  LlmProviderRow,
  LlmProviderSettingsDocument,
} from "../../../backend/src/contracts/settings";
import type { ModelCapabilityRow, ModelCapabilityOverrideUpsert } from "../../../backend/src/contracts/model-catalog";
import {
  validateGetLlmSettingsResponse,
  validateLlmProviderConnectionTestResponse,
  validateLlmProviderSettingsResponse,
} from "../../../backend/src/contracts/settings";
import type { ToolCatalogItemResponse } from "../../../backend/src/contracts/system";
import { validateGetToolsResponse } from "../../../backend/src/contracts/system";
import type { UploadFileResponse } from "../../../backend/src/contracts/uploads";
import type { LlmRef } from "../../../backend/src/contracts/llm";
import { validateUploadFileResponse } from "../../../backend/src/contracts/uploads";
import type {
  ModelPresetResponse,
  ModelPresetUpsertRequest,
  DeleteModelPresetResponse,
} from "../../../backend/src/contracts/model-presets";
import {
  validateDeleteModelPresetResponse,
  validateGetModelPresetsResponse,
  validateModelPresetResponse,
} from "../../../backend/src/contracts/model-presets";
export type { PostConversationMessageAcceptedResponse } from "../../../backend/src/contracts/conversations";

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

export async function sendJson(path: string, method: string, body: unknown): Promise<unknown> {
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
export async function postJsonAccepted(path: string, body: unknown): Promise<PostAcceptedResult<unknown>> {
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

export type AttachmentMode = "direct" | "summary";

export type PostMessageAttachment = {
  id: string;
  /**
   * - `direct`: raw bytes are inlined into the planner call (image/file part).
   * - `summary`: a one-shot summarize-attachment thought runs first; the
   *   planner sees the summary text and may call `ask_attachment` for
   *   follow-up questions against the full content.
   */
  mode: AttachmentMode;
};

export type PostConversationMessageInput = {
  message: string;
  agentId: string;
  llm?: LlmRef;
  modelPresetId?: number;
  attachments?: PostMessageAttachment[];
  /** The entry the user wants this message attached to. Required when the conversation is non-empty. */
  parentId?: string | null;
  /** Echoed back on the resulting USER_MESSAGE SSE event for optimistic reconciliation. */
  clientRequestId?: string;
};

export function getConversations(options?: { deletedOnly?: boolean }): Promise<GetConversationsResponse> {
  const deletedOnly = options?.deletedOnly === true;
  const path = deletedOnly ? "/api/conversations?deleted=only" : "/api/conversations";
  return getJson(path).then(validateGetConversationsResponse);
}

export function getConversation(conversationId: string): Promise<ConversationRow> {
  return getJson(`/api/conversations/${encodeURIComponent(conversationId)}`).then((data) =>
    validateConversationRowResponse(data, "GET /api/conversations/:id"),
  );
}

export async function getConversationDefaultViewLeafEntryId(conversationId: string): Promise<string | null> {
  const data = await getJson(`/api/conversations/${encodeURIComponent(conversationId)}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("GET /api/conversations/:id: invalid response envelope");
  }
  const raw = (data as { defaultViewLeafEntryId?: unknown }).defaultViewLeafEntryId;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new Error("GET /api/conversations/:id: defaultViewLeafEntryId must be string or null");
  }
  return raw.length > 0 ? raw : null;
}

export function createConversation(body: { title?: string } = {}): Promise<ConversationRow> {
  return sendJson("/api/conversations", "POST", body).then(validatePostConversationsResponse);
}

export function renameConversation(
  conversationId: string,
  body: { title?: string; groupId?: string | null; newGroupName?: string },
): Promise<ConversationRow> {
  return sendJson(`/api/conversations/${encodeURIComponent(conversationId)}`, "PUT", body).then((data) =>
    validateConversationRowResponse(data, "PUT /api/conversations/:id"),
  );
}

export function softDeleteConversation(conversationId: string): Promise<ConversationRow> {
  return deleteJson(`/api/conversations/${encodeURIComponent(conversationId)}`).then((data) =>
    validateConversationRowResponse(data, "DELETE /api/conversations/:id"),
  );
}

export function undeleteConversation(conversationId: string): Promise<ConversationRow> {
  return postJsonAccepted(`/api/conversations/${encodeURIComponent(conversationId)}/undelete`, {}).then((result) =>
    validateConversationRowResponse(result.data, "POST /api/conversations/:id/undelete"),
  );
}

export function permanentlyDeleteConversation(conversationId: string): Promise<unknown> {
  return deleteJson(`/api/conversations/${encodeURIComponent(conversationId)}/permanent`);
}

export function getConversationMessages(
  conversationId: string,
  options?: {
    all?: boolean;
  },
): Promise<ChatMessageEntry[]> {
  const allQuery = options?.all === true ? "?all=1" : "";
  return getJson(`/api/conversations/${encodeURIComponent(conversationId)}/messages${allQuery}`).then(
    validateGetConversationMessagesResponse,
  );
}

export async function setConversationDefaultViewLeaf(
  conversationId: string,
  entryId: string,
): Promise<{ conversationId: string; defaultViewLeafEntryId: string }> {
  const result = await postJsonAccepted(`/api/conversations/${encodeURIComponent(conversationId)}/default-view-leaf`, {
    entryId,
  });
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("POST /api/conversations/:id/default-view-leaf: invalid response envelope");
  }
  const row = data as {
    conversationId?: unknown;
    defaultViewLeafEntryId?: unknown;
  };
  const nextConversationId = String(row.conversationId ?? "").trim();
  const defaultViewLeafEntryId = String(row.defaultViewLeafEntryId ?? "").trim();
  if (!nextConversationId || !defaultViewLeafEntryId) {
    throw new Error("POST /api/conversations/:id/default-view-leaf: invalid response fields");
  }
  return {
    conversationId: nextConversationId,
    defaultViewLeafEntryId,
  };
}

export async function postConversationMessage(
  conversationId: string,
  body: PostConversationMessageInput,
): Promise<PostAcceptedResult<PostConversationMessageAcceptedResponse>> {
  const result = await postJsonAccepted(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, body);
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
    `/api/conversations/${encodeURIComponent(conversationId)}/tool-invocations/${encodeURIComponent(entryId)}/approve`,
    {},
  );
}

export async function getTasks(): Promise<import("../../../backend/src/contracts/task").TaskInfo[]> {
  const data = (await getJson("/api/tasks")) as { tasks?: unknown };
  if (!data || !Array.isArray(data.tasks)) throw new Error("GET /api/tasks: invalid response");
  return data.tasks as import("../../../backend/src/contracts/task").TaskInfo[];
}

export async function cancelTask(taskId: string): Promise<void> {
  await postJsonAccepted(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {});
}

export async function reprocessThought(
  conversationId: string,
  entryId: string,
  editedResponse: string,
): Promise<PostAcceptedResult<{ conversationId: string; plannerEntryId: string; queuedToolCalls: number }>> {
  const result = await postJsonAccepted(
    `/api/conversations/${encodeURIComponent(conversationId)}/thoughts/${encodeURIComponent(entryId)}/reprocess-reason`,
    { editedResponse },
  );
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("POST /api/conversations/:id/thoughts/:entryId/reprocess: invalid response envelope");
  }
  const row = data as {
    conversationId?: unknown;
    plannerEntryId?: unknown;
    queuedToolCalls?: unknown;
  };
  const conversationIdOut = String(row.conversationId ?? "").trim();
  const plannerEntryId = String(row.plannerEntryId ?? "").trim();
  const queuedToolCalls =
    typeof row.queuedToolCalls === "number" && Number.isFinite(row.queuedToolCalls)
      ? Math.max(0, Math.trunc(row.queuedToolCalls))
      : NaN;
  if (!conversationIdOut || !plannerEntryId || Number.isNaN(queuedToolCalls)) {
    throw new Error("POST /api/conversations/:id/thoughts/:entryId/reprocess: invalid response fields");
  }
  return {
    status: result.status,
    data: {
      conversationId: conversationIdOut,
      plannerEntryId,
      queuedToolCalls,
    },
  };
}

export async function reprocessUserMessage(
  conversationId: string,
  entryId: string,
  editedText: string,
): Promise<PostAcceptedResult<{ conversationId: string; userMessageEntryId: string }>> {
  const result = await postJsonAccepted(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(entryId)}/reprocess`,
    { editedText },
  );
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("POST /api/conversations/:id/messages/:entryId/reprocess: invalid response envelope");
  }
  const row = data as { conversationId?: unknown; userMessageEntryId?: unknown };
  const conversationIdOut = String(row.conversationId ?? "").trim();
  const userMessageEntryId = String(row.userMessageEntryId ?? "").trim();
  if (!conversationIdOut || !userMessageEntryId) {
    throw new Error("POST /api/conversations/:id/messages/:entryId/reprocess: invalid response fields");
  }
  return {
    status: result.status,
    data: { conversationId: conversationIdOut, userMessageEntryId },
  };
}

export async function reprocessThoughtContext(
  conversationId: string,
  entryId: string,
  input: {
    editedRequestText: string;
    llm: LlmRef;
  },
): Promise<PostAcceptedResult<{ conversationId: string; plannerEntryId: string; queuedToolCalls: number }>> {
  const result = await postJsonAccepted(
    `/api/conversations/${encodeURIComponent(conversationId)}/thoughts/${encodeURIComponent(entryId)}/reprocess-context`,
    input,
  );
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("POST /api/conversations/:id/thoughts/:entryId/reprocess: invalid response envelope");
  }
  const row = data as {
    conversationId?: unknown;
    plannerEntryId?: unknown;
    queuedToolCalls?: unknown;
  };
  const conversationIdOut = String(row.conversationId ?? "").trim();
  const plannerEntryId = String(row.plannerEntryId ?? "").trim();
  const queuedToolCalls =
    typeof row.queuedToolCalls === "number" && Number.isFinite(row.queuedToolCalls)
      ? Math.max(0, Math.trunc(row.queuedToolCalls))
      : NaN;
  if (!conversationIdOut || !plannerEntryId || Number.isNaN(queuedToolCalls)) {
    throw new Error("POST /api/conversations/:id/thoughts/:entryId/reprocess: invalid response fields");
  }
  return {
    status: result.status,
    data: {
      conversationId: conversationIdOut,
      plannerEntryId,
      queuedToolCalls,
    },
  };
}

export async function summarizeConversation(
  conversationId: string,
  input: { firstEntryToSummarize: string },
): Promise<{ conversationId: string }> {
  const result = await postJsonAccepted(
    `/api/conversations/${encodeURIComponent(conversationId)}/summarize`,
    input,
  );
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("POST /api/conversations/:id/summarize: invalid response envelope");
  }
  const row = data as { conversationId?: unknown };
  const out = String(row.conversationId ?? "").trim();
  if (!out) throw new Error("POST /api/conversations/:id/summarize: invalid response fields");
  return { conversationId: out };
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
  return getJson("/api/settings/llm_provider").then(validateLlmProviderSettingsResponse);
}

export function getModelCapabilities(): Promise<{
  models: ModelCapabilityRow[];
}> {
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
        throw new Error(`GET /api/settings/model_capabilities: models[${index}] must be an object`);
      }
      const row = raw as Record<string, unknown>;
      const providerId = String(row.provider_id ?? "").trim();
      const modelName = String(row.model_name ?? "").trim();
      if (!providerId || !modelName) {
        throw new Error(`GET /api/settings/model_capabilities: models[${index}] missing provider_id/model_name`);
      }
      return raw as ModelCapabilityRow;
    });
    return { models };
  });
}

export function updateModelCapabilityOverride(
  body: ModelCapabilityOverrideUpsert,
): Promise<{ models: ModelCapabilityRow[] }> {
  return sendJson("/api/settings/model_capabilities/override", "PUT", body).then((data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("PUT /api/settings/model_capabilities/override: invalid response envelope");
    }
    return data as { models: ModelCapabilityRow[] };
  });
}

export function updateLlmProviderSettings(body: LlmProviderSettingsDocument): Promise<LlmProviderSettingsDocument> {
  return sendJson("/api/settings/llm_provider", "PUT", body).then(validateLlmProviderSettingsResponse);
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
  return getJson(`/api/agents/${encodeURIComponent(agentId)}`).then(validateAgentResponse);
}

export function updateAgentById(agentId: string, body: AgentUpsertRequest): Promise<AgentListItemResponse> {
  return sendJson(`/api/agents/${encodeURIComponent(agentId)}`, "PUT", body).then(validateAgentResponse);
}

export function createAgent(body: AgentUpsertRequest = {}): Promise<AgentListItemResponse> {
  return sendJson("/api/agents", "POST", body).then(validateAgentResponse);
}

export function deleteAgentById(agentId: string): Promise<DeleteAgentResponse> {
  return deleteJson(`/api/agents/${encodeURIComponent(agentId)}`).then(validateDeleteAgentResponse);
}

export function setDefaultAgent(agentId: string): Promise<AgentListItemResponse> {
  return sendJson(`/api/agents/${encodeURIComponent(agentId)}/default`, "POST", {}).then(validateAgentResponse);
}

export function getModelPresets(): Promise<ModelPresetResponse[]> {
  return getJson("/api/model-presets").then(validateGetModelPresetsResponse);
}

export function getModelPresetById(presetId: number): Promise<ModelPresetResponse> {
  return getJson(`/api/model-presets/${encodeURIComponent(String(presetId))}`).then(validateModelPresetResponse);
}

export function createModelPreset(body: ModelPresetUpsertRequest = {}): Promise<ModelPresetResponse> {
  return sendJson("/api/model-presets", "POST", body).then(validateModelPresetResponse);
}

export function updateModelPresetById(presetId: number, body: ModelPresetUpsertRequest): Promise<ModelPresetResponse> {
  return sendJson(`/api/model-presets/${encodeURIComponent(String(presetId))}`, "PUT", body).then(
    validateModelPresetResponse,
  );
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
  return sendJson(`/api/approvals/${encodeURIComponent(String(approvalId))}/decision`, "POST", body);
}
