import type { AssistantMessageEntryRow, ChatMessageEntryRow, UserMessageEntryRow } from './chat-entries.types.js';

export type ChatEntryDbRow = {
  id: string;
  conversation_id: string;
  conversation_index: number;
  parent_id: string | null;
  type: string;
  payload_json: string;
  created_at: string;
};

function parsePayload(row: ChatEntryDbRow): Record<string, unknown> {
  const payload = JSON.parse(row.payload_json) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`invalid chat entry payload: ${row.id}`);
  }
  return payload as Record<string, unknown>;
}

function parseUserMessageRow(row: ChatEntryDbRow, payload: Record<string, unknown>): UserMessageEntryRow {
  const agentId = String(payload.agentId ?? '').trim();
  if (!agentId) throw new Error(`invalid user-message payload: missing agentId (${row.id})`);
  const userRow: UserMessageEntryRow = {
    type: 'user-message',
    id: row.id,
    conversationIndex: row.conversation_index,
    createdAt: row.created_at,
    parentId: row.parent_id,
    text: String(payload.text ?? ''),
    agentId,
  };
  if (typeof payload.llmProviderId === 'string' && payload.llmProviderId) userRow.llmProviderId = payload.llmProviderId;
  if (typeof payload.llmModel === 'string' && payload.llmModel) userRow.llmModel = payload.llmModel;
  if (typeof payload.modelPresetId === 'number' && Number.isFinite(payload.modelPresetId)) {
    userRow.modelPresetId = payload.modelPresetId;
  }
  return userRow;
}

function parseAssistantMessageRow(row: ChatEntryDbRow, payload: Record<string, unknown>): AssistantMessageEntryRow {
  return {
    type: 'assistant-message',
    id: row.id,
    conversationIndex: row.conversation_index,
    createdAt: row.created_at,
    parentId: row.parent_id,
    text: String(payload.text ?? ''),
  };
}

export function rowToChatMessage(row: ChatEntryDbRow): ChatMessageEntryRow | null {
  if (row.type !== 'user-message' && row.type !== 'assistant-message') return null;
  const payload = parsePayload(row);
  if (row.type === 'user-message') return parseUserMessageRow(row, payload);
  return parseAssistantMessageRow(row, payload);
}
