import type {
  ChatEntry,
  ChatEntryBase,
  PlannerLlmStreamEntry,
  ThoughtStepStatus,
  TitleLlmStreamEntry,
} from '../../contracts/chatEntry.js';
import type { ChatEntryDbRow } from './chat-entries.payload.js';

const STEP_STATUSES: readonly ThoughtStepStatus[] = ['running', 'completed', 'failed', 'cancelled'];
const TOOL_STATES = ['requested', 'running', 'done', 'error'] as const;
type ToolState = (typeof TOOL_STATES)[number];

export function rowToChatEntry(row: ChatEntryDbRow): ChatEntry {
  const ctx = `chat_entries[${row.id}] (${row.type})`;
  const payload = parsePayload(row.payload_json, ctx);
  const base: ChatEntryBase = {
    id: row.id,
    conversationIndex: row.conversation_index,
    createdAt: row.created_at,
    parentId: row.parent_id,
  };
  switch (row.type) {
    case 'user-message':
      return mapUserMessage(base, payload, ctx);
    case 'assistant-message':
      return { ...base, type: 'assistant-message', text: requireString(payload, 'text', ctx) };
    case 'thought-prepare':
      return mapThoughtPrepare(base, payload, ctx);
    case 'thought-action':
      return mapThoughtAction(base, payload, ctx);
    case 'planner_llm_stream':
      return mapStream(base, payload, 'planner_llm_stream', ctx);
    case 'title_llm_stream':
      return mapStream(base, payload, 'title_llm_stream', ctx);
    case 'tool-invocation':
      return mapToolInvocation(base, payload, ctx);
    default:
      throw new Error(`${ctx}: unknown chat entry type`);
  }
}

function mapUserMessage(base: ChatEntryBase, payload: Record<string, unknown>, ctx: string): ChatEntry {
  const out: ChatEntry = {
    ...base,
    type: 'user-message',
    text: requireString(payload, 'text', ctx),
    agentId: requireString(payload, 'agentId', ctx),
  };
  const llmProviderId = optionalString(payload, 'llmProviderId', ctx);
  if (llmProviderId !== undefined) out.llmProviderId = llmProviderId;
  const llmModel = optionalString(payload, 'llmModel', ctx);
  if (llmModel !== undefined) out.llmModel = llmModel;
  if (payload.modelPresetId !== undefined) {
    if (payload.modelPresetId !== null && (typeof payload.modelPresetId !== 'number' || !Number.isFinite(payload.modelPresetId))) {
      throw new Error(`${ctx}: modelPresetId must be number or null`);
    }
    out.modelPresetId = payload.modelPresetId as number | null;
  }
  return out;
}

function mapThoughtPrepare(base: ChatEntryBase, payload: Record<string, unknown>, ctx: string): ChatEntry {
  const out: ChatEntry = {
    ...base,
    type: 'thought-prepare',
    thoughtId: requireString(payload, 'thoughtId', ctx),
    requestText: requireString(payload, 'requestText', ctx),
  };
  const title = optionalString(payload, 'title', ctx);
  if (title !== undefined) out.title = title;
  const llmProviderId = optionalString(payload, 'llmProviderId', ctx);
  if (llmProviderId !== undefined) out.llmProviderId = llmProviderId;
  const llmModel = optionalString(payload, 'llmModel', ctx);
  if (llmModel !== undefined) out.llmModel = llmModel;
  return out;
}

function mapThoughtAction(base: ChatEntryBase, payload: Record<string, unknown>, ctx: string): ChatEntry {
  const out: ChatEntry = {
    ...base,
    type: 'thought-action',
    thoughtId: requireString(payload, 'thoughtId', ctx),
    status: requireStatus(payload, ctx),
  };
  const summary = optionalString(payload, 'summary', ctx);
  if (summary !== undefined) out.summary = summary;
  const action = optionalString(payload, 'action', ctx);
  if (action !== undefined) out.action = action;
  const toolName = optionalString(payload, 'toolName', ctx);
  if (toolName !== undefined) out.toolName = toolName;
  const error = optionalString(payload, 'error', ctx);
  if (error !== undefined) out.error = error;
  return out;
}

function mapStream(
  base: ChatEntryBase,
  payload: Record<string, unknown>,
  type: 'planner_llm_stream' | 'title_llm_stream',
  ctx: string,
): ChatEntry {
  const stream: PlannerLlmStreamEntry = {
    ...base,
    type: 'planner_llm_stream',
    thoughtId: requireString(payload, 'thoughtId', ctx),
    llmRequest: requireString(payload, 'llmRequest', ctx),
    status: requireStatus(payload, ctx),
  };
  const llmProviderId = optionalString(payload, 'llmProviderId', ctx);
  if (llmProviderId !== undefined) stream.llmProviderId = llmProviderId;
  const llmModel = optionalString(payload, 'llmModel', ctx);
  if (llmModel !== undefined) stream.llmModel = llmModel;
  if (typeof payload.llmResponse === 'string') stream.llmResponse = payload.llmResponse;
  if (payload.thoughtMs !== undefined) {
    if (payload.thoughtMs !== null && (typeof payload.thoughtMs !== 'number' || !Number.isFinite(payload.thoughtMs))) {
      throw new Error(`${ctx}: thoughtMs must be number or null`);
    }
    stream.thoughtMs = payload.thoughtMs as number | null;
  }
  const error = optionalString(payload, 'error', ctx);
  if (error !== undefined) stream.error = error;
  if (payload.promptTokens !== undefined) stream.promptTokens = requireFiniteNumber(payload, 'promptTokens', ctx);
  if (payload.completionTokens !== undefined) stream.completionTokens = requireFiniteNumber(payload, 'completionTokens', ctx);
  if (payload.cachedPromptTokens !== undefined) stream.cachedPromptTokens = requireFiniteNumber(payload, 'cachedPromptTokens', ctx);
  if (type === 'planner_llm_stream') return stream;
  const title: TitleLlmStreamEntry = { ...stream, type: 'title_llm_stream' };
  return title;
}

function mapToolInvocation(base: ChatEntryBase, payload: Record<string, unknown>, ctx: string): ChatEntry {
  return {
    ...base,
    type: 'tool-invocation',
    toolId: requireString(payload, 'toolId', ctx),
    state: requireToolState(payload, ctx),
    parameters: requireRecord(payload.parameters, `${ctx}.parameters`),
    result: payload.result,
  };
}

function parsePayload(json: string, ctx: string): Record<string, unknown> {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${ctx}: payload_json is not an object`);
  }
  return parsed as Record<string, unknown>;
}

function requireString(payload: Record<string, unknown>, key: string, ctx: string): string {
  const value = payload[key];
  if (typeof value !== 'string') throw new Error(`${ctx}: missing or invalid string field '${key}'`);
  return value;
}

function optionalString(payload: Record<string, unknown>, key: string, ctx: string): string | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${ctx}: field '${key}' must be a string when present`);
  return value;
}

function requireFiniteNumber(payload: Record<string, unknown>, key: string, ctx: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${ctx}: field '${key}' must be a finite number`);
  }
  return value;
}

function requireStatus(payload: Record<string, unknown>, ctx: string): ThoughtStepStatus {
  const value = payload.status;
  if (typeof value !== 'string' || !STEP_STATUSES.includes(value as ThoughtStepStatus)) {
    throw new Error(`${ctx}: missing or invalid status (got ${String(value)})`);
  }
  return value as ThoughtStepStatus;
}

function requireToolState(payload: Record<string, unknown>, ctx: string): ToolState {
  const value = payload.state;
  if (typeof value !== 'string' || !TOOL_STATES.includes(value as ToolState)) {
    throw new Error(`${ctx}: missing or invalid tool state (got ${String(value)})`);
  }
  return value as ToolState;
}

function requireRecord(value: unknown, ctx: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${ctx}: must be an object`);
  }
  return value as Record<string, unknown>;
}
