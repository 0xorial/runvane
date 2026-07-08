import type {
  ChatAttachment,
  ChatEntry,
  ChatEntryBase,
  CheckpointSummaryEntry,
  ContextInjectionEntry,
  ThoughtStepStatus,
  ThoughtStreamEntry,
  ThoughtType,
} from '../../contracts/chatEntry.js';
import { ChatAttachmentSchema, ThoughtTypeSchema, ToolEnvelopeSchema } from '../../contracts/chatEntry.js';
import { PreinjectedFileRecordSchema } from '../../contracts/preinject.js';
import { ProviderCostBreakdownSchema } from '../../contracts/provider-cost.js';
import { LlmRefSchema, type LlmRef } from '../../contracts/llm.js';
import { UserMessageOverridesSchema } from '../../contracts/user-message-overrides.js';
import { z } from 'zod';
import type { ChatEntryDbRow } from './chat-entries.types.js';

const STEP_STATUSES: readonly ThoughtStepStatus[] = ['running', 'completed', 'failed', 'cancelled'];

const AttachmentsArraySchema = z.array(ChatAttachmentSchema);
const TOOL_STATES = ['resolving', 'requested', 'running', 'done', 'error', 'denied'] as const;
type ToolState = (typeof TOOL_STATES)[number];

export function rowToChatEntry(row: ChatEntryDbRow): ChatEntry {
  const ctx = `chat_entries[${row.id}] (${row.type})`;
  const payload = parsePayload(row.payload_json, ctx);
  const base: ChatEntryBase = {
    id: row.id,
    conversationIndex: row.conversation_index,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    parentId: row.parent_id,
    isSide: Boolean(row.is_side),
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
    case 'thought_stream':
      return mapStream(base, payload, ctx);
    case 'tool-invocation':
      return mapToolInvocation(base, payload, ctx);
    case 'checkpoint-summary':
      return mapCheckpointSummary(base, payload, ctx);
    case 'context-injection':
      return mapContextInjection(base, payload, ctx);
    default:
      throw new Error(`${ctx}: unknown chat entry type`);
  }
}

const CheckpointSummaryPayloadSchema = z.object({
  summaryText: z.string(),
  summarizedRange: z.object({ fromEntryId: z.string(), toEntryId: z.string() }),
  rangeEntryCount: z.number().optional(),
  rangeInputTokens: z.number().optional(),
  summaryTokens: z.number().optional(),
});

function mapCheckpointSummary(base: ChatEntryBase, payload: Record<string, unknown>, ctx: string): CheckpointSummaryEntry {
  const p = CheckpointSummaryPayloadSchema.parse(payload);
  return { ...base, type: 'checkpoint-summary', ...p };
}

const ContextInjectionPayloadSchema = z.object({
  files: z.array(PreinjectedFileRecordSchema),
  content: z.string(),
});

function mapContextInjection(base: ChatEntryBase, payload: Record<string, unknown>, ctx: string): ContextInjectionEntry {
  const p = ContextInjectionPayloadSchema.safeParse(payload);
  if (!p.success) throw new Error(`${ctx}: ${p.error.message}`);
  return { ...base, type: 'context-injection', ...p.data };
}

function mapUserMessage(base: ChatEntryBase, payload: Record<string, unknown>, ctx: string): ChatEntry {
  const out: ChatEntry = {
    ...base,
    type: 'user-message',
    text: requireString(payload, 'text', ctx),
    agentId: requireString(payload, 'agentId', ctx),
  };
  const llm = optionalLlmRef(payload, ctx);
  if (llm !== undefined) out.llm = llm;
  if (payload.modelPresetId !== undefined) {
    if (payload.modelPresetId !== null && (typeof payload.modelPresetId !== 'number' || !Number.isFinite(payload.modelPresetId))) {
      throw new Error(`${ctx}: modelPresetId must be number or null`);
    }
    out.modelPresetId = payload.modelPresetId as number | null;
  }
  const attachments = parseAttachments(payload.attachments, ctx);
  if (attachments) out.attachments = attachments;
  const overrides = parseUserMessageOverrides(payload.overrides, ctx);
  if (overrides) out.overrides = overrides;
  return out;
}

function parseUserMessageOverrides(value: unknown, ctx: string) {
  if (value === undefined || value === null) return undefined;
  const parsed = UserMessageOverridesSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${ctx}.overrides: ${parsed.error.message}`);
  }
  return parsed.data;
}

function parseAttachments(value: unknown, ctx: string): ChatAttachment[] | null {
  if (value === undefined || value === null) return null;
  const parsed = AttachmentsArraySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${ctx}.attachments: ${parsed.error.message}`);
  }
  return parsed.data;
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
  const llm = optionalLlmRef(payload, ctx);
  if (llm !== undefined) out.llm = llm;
  const inputJson = optionalString(payload, 'inputJson', ctx);
  if (inputJson !== undefined) out.inputJson = inputJson;
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

function mapStream(base: ChatEntryBase, payload: Record<string, unknown>, ctx: string): ThoughtStreamEntry {
  const stream: ThoughtStreamEntry = {
    ...base,
    type: 'thought_stream',
    thoughtType: requireThoughtType(payload, ctx),
    thoughtId: requireString(payload, 'thoughtId', ctx),
    llmRequest: requireString(payload, 'llmRequest', ctx),
    status: requireStatus(payload, ctx),
  };
  const llm = optionalLlmRef(payload, ctx);
  if (llm !== undefined) stream.llm = llm;
  if (typeof payload.llmResponse === 'string') stream.llmResponse = payload.llmResponse;
  if (typeof payload.assembledResponse === 'string') stream.assembledResponse = payload.assembledResponse;
  if (typeof payload.thinkingText === 'string') stream.thinkingText = payload.thinkingText;
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
  if (payload.provider_cost !== undefined) stream.provider_cost = requireFiniteNumber(payload, 'provider_cost', ctx);
  if (payload.provider_cost_breakdown !== undefined) {
    stream.provider_cost_breakdown = ProviderCostBreakdownSchema.parse(payload.provider_cost_breakdown);
  }
  // summarize_attachment carries the persisted summary + source-file metadata.
  if (stream.thoughtType === 'summarize_attachment') {
    stream.attachmentId = requireString(payload, 'attachmentId', ctx);
    stream.userMessageId = requireString(payload, 'userMessageId', ctx);
    const filename = optionalString(payload, 'filename', ctx);
    if (filename !== undefined) stream.filename = filename;
    const mimeType = optionalString(payload, 'mimeType', ctx);
    if (mimeType !== undefined) stream.mimeType = mimeType;
    if (payload.sizeBytes !== undefined) stream.sizeBytes = requireFiniteNumber(payload, 'sizeBytes', ctx);
    const summaryText = optionalString(payload, 'summaryText', ctx);
    if (summaryText !== undefined) stream.summaryText = summaryText;
  }
  return stream;
}

function requireThoughtType(payload: Record<string, unknown>, ctx: string): ThoughtType {
  const parsed = ThoughtTypeSchema.safeParse(payload.thoughtType);
  if (!parsed.success) {
    throw new Error(`${ctx}: missing or invalid thoughtType (got ${String(payload.thoughtType)})`);
  }
  return parsed.data;
}

function mapToolInvocation(base: ChatEntryBase, payload: Record<string, unknown>, ctx: string): ChatEntry {
  let result: z.infer<typeof ToolEnvelopeSchema> | null | undefined;
  if (payload.result === undefined) {
    result = undefined;
  } else if (payload.result === null) {
    result = null;
  } else {
    const parsed = ToolEnvelopeSchema.safeParse(payload.result);
    if (!parsed.success) {
      throw new Error(`${ctx}.result: invalid tool envelope: ${parsed.error.message}`);
    }
    result = parsed.data;
  }
  return {
    ...base,
    type: 'tool-invocation',
    toolId: requireString(payload, 'toolId', ctx),
    state: requireToolState(payload, ctx),
    parameters: requireRecord(payload.parameters, `${ctx}.parameters`),
    ...(payload.originalParameters !== undefined
      ? { originalParameters: requireRecord(payload.originalParameters, `${ctx}.originalParameters`) }
      : {}),
    ...(payload.parametersEdited === true ? { parametersEdited: true } : {}),
    ...(Number.isInteger(payload.attempt) && (payload.attempt as number) >= 1
      ? { attempt: payload.attempt as number }
      : {}),
    result,
  };
}

/**
 * Reads the nested `llm` ref from a payload. Entries persisted before the
 * llmProviderId/llmModel → llm consolidation have no `llm` key and resolve to
 * undefined (their model label is lost — accepted tradeoff).
 */
function optionalLlmRef(payload: Record<string, unknown>, ctx: string): LlmRef | undefined {
  if (payload.llm === undefined || payload.llm === null) return undefined;
  const parsed = LlmRefSchema.safeParse(payload.llm);
  if (!parsed.success) throw new Error(`${ctx}.llm: invalid LLM ref: ${parsed.error.message}`);
  return parsed.data;
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
