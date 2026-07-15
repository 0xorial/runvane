import type {
  ChatAttachment,
  ChatEntry,
  ChatEntryBase,
  CheckpointSummaryEntry,
  ContextInjectionEntry,
  ThoughtEntry,
  ThoughtForkPoint,
  ThoughtStage,
  ThoughtStepStatus,
  ThoughtType,
} from '../../contracts/chatEntry.js';
import {
  ChatAttachmentSchema,
  LlmDecisionSchema,
  PlannerParseResultSchema,
  ThoughtForkPointSchema,
  ThoughtStageSchema,
  ThoughtTypeSchema,
  ToolEnvelopeSchema,
} from '../../contracts/chatEntry.js';
import { PreinjectedFileRecordSchema } from '../../contracts/preinject.js';
import { RetrievalHitSchema, RetrievalQuerySchema } from '../../contracts/retrieval.js';
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
    case 'thought':
      return mapThought(base, payload, ctx);
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

// The unified context-injection entry is one of two source-specific shapes;
// dispatch on `source` and enforce the exact fields per source (strict, so a
// files row can't smuggle knowledge fields and vice versa).
const FilesContextPayloadSchema = z.object({
  source: z.literal('files'),
  files: z.array(PreinjectedFileRecordSchema),
  content: z.string(),
});

const KnowledgeContextPayloadSchema = z.object({
  source: z.literal('knowledge'),
  state: z.enum(['pending', 'done', 'failed']),
  queries: z.array(RetrievalQuerySchema),
  storages: z.array(z.string()),
  hits: z.array(RetrievalHitSchema),
  error: z.string().optional(),
});

function mapContextInjection(base: ChatEntryBase, payload: Record<string, unknown>, ctx: string): ContextInjectionEntry {
  const source = payload.source;
  const p =
    source === 'knowledge'
      ? KnowledgeContextPayloadSchema.safeParse(payload)
      : FilesContextPayloadSchema.safeParse(payload);
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

function mapThought(base: ChatEntryBase, payload: Record<string, unknown>, ctx: string): ThoughtEntry {
  const thought: ThoughtEntry = {
    ...base,
    type: 'thought',
    thoughtType: requireThoughtType(payload, ctx),
    stage: requireStage(payload, ctx),
    status: requireStatus(payload, ctx),
  };
  const error = optionalString(payload, 'error', ctx);
  if (error !== undefined) thought.error = error;
  const title = optionalString(payload, 'title', ctx);
  if (title !== undefined) thought.title = title;
  const llm = optionalLlmRef(payload, ctx);
  if (llm !== undefined) thought.llm = llm;
  const inputJson = optionalString(payload, 'inputJson', ctx);
  if (inputJson !== undefined) thought.inputJson = inputJson;
  const forkOf = optionalString(payload, 'forkOf', ctx);
  if (forkOf !== undefined) thought.forkOf = forkOf;
  if (payload.forkPoint !== undefined) thought.forkPoint = requireForkPoint(payload, ctx);
  if (typeof payload.llmRequest === 'string') thought.llmRequest = payload.llmRequest;
  if (typeof payload.llmResponse === 'string') thought.llmResponse = payload.llmResponse;
  if (typeof payload.assembledResponse === 'string') thought.assembledResponse = payload.assembledResponse;
  if (typeof payload.thinkingText === 'string') thought.thinkingText = payload.thinkingText;
  if (payload.thoughtMs !== undefined) {
    if (payload.thoughtMs !== null && (typeof payload.thoughtMs !== 'number' || !Number.isFinite(payload.thoughtMs))) {
      throw new Error(`${ctx}: thoughtMs must be number or null`);
    }
    thought.thoughtMs = payload.thoughtMs as number | null;
  }
  if (payload.promptTokens !== undefined) thought.promptTokens = requireFiniteNumber(payload, 'promptTokens', ctx);
  if (payload.completionTokens !== undefined) thought.completionTokens = requireFiniteNumber(payload, 'completionTokens', ctx);
  if (payload.cachedPromptTokens !== undefined) thought.cachedPromptTokens = requireFiniteNumber(payload, 'cachedPromptTokens', ctx);
  if (payload.provider_cost !== undefined) thought.provider_cost = requireFiniteNumber(payload, 'provider_cost', ctx);
  if (payload.provider_cost_breakdown !== undefined) {
    thought.provider_cost_breakdown = ProviderCostBreakdownSchema.parse(payload.provider_cost_breakdown);
  }
  if (payload.decision !== undefined) {
    thought.decision = payload.decision === null ? null : LlmDecisionSchema.parse(payload.decision);
  }
  if (payload.parseResult !== undefined) {
    thought.parseResult = PlannerParseResultSchema.parse(payload.parseResult);
  }
  const summary = optionalString(payload, 'summary', ctx);
  if (summary !== undefined) thought.summary = summary;
  const action = optionalString(payload, 'action', ctx);
  if (action !== undefined) thought.action = action;
  const toolName = optionalString(payload, 'toolName', ctx);
  if (toolName !== undefined) thought.toolName = toolName;
  // summarize_attachment carries the persisted summary + source-file metadata.
  if (thought.thoughtType === 'summarize_attachment') {
    thought.attachmentId = requireString(payload, 'attachmentId', ctx);
    thought.userMessageId = requireString(payload, 'userMessageId', ctx);
    const filename = optionalString(payload, 'filename', ctx);
    if (filename !== undefined) thought.filename = filename;
    const mimeType = optionalString(payload, 'mimeType', ctx);
    if (mimeType !== undefined) thought.mimeType = mimeType;
    if (payload.sizeBytes !== undefined) thought.sizeBytes = requireFiniteNumber(payload, 'sizeBytes', ctx);
    const summaryText = optionalString(payload, 'summaryText', ctx);
    if (summaryText !== undefined) thought.summaryText = summaryText;
  }
  return thought;
}

function requireThoughtType(payload: Record<string, unknown>, ctx: string): ThoughtType {
  const parsed = ThoughtTypeSchema.safeParse(payload.thoughtType);
  if (!parsed.success) {
    throw new Error(`${ctx}: missing or invalid thoughtType (got ${String(payload.thoughtType)})`);
  }
  return parsed.data;
}

function requireStage(payload: Record<string, unknown>, ctx: string): ThoughtStage {
  const parsed = ThoughtStageSchema.safeParse(payload.stage);
  if (!parsed.success) {
    throw new Error(`${ctx}: missing or invalid stage (got ${String(payload.stage)})`);
  }
  return parsed.data;
}

function requireForkPoint(payload: Record<string, unknown>, ctx: string): ThoughtForkPoint {
  const parsed = ThoughtForkPointSchema.safeParse(payload.forkPoint);
  if (!parsed.success) {
    throw new Error(`${ctx}: invalid forkPoint (got ${String(payload.forkPoint)})`);
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
