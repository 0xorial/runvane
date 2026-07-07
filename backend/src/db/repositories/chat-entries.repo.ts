import { Injectable } from '@nestjs/common';
import { aggregateTokenUsageByModel } from '../../conversations/token-usage-by-model.js';
import type { ConversationRow } from '../../contracts/conversations.js';
import type {
  AssistantMessageEntry,
  ChatAttachment,
  ToolInvocationEntry,
  UserMessageEntry,
} from '../../contracts/chatEntry.js';
import type { UserMessageOverrides } from '../../contracts/user-message-overrides.js';
import type { LlmRef } from '../../contracts/llm.js';
import type { ThoughtType } from '../../contracts/chatEntry.js';
import type { PreinjectedFileRecord } from '../../contracts/preinject.js';
import { PrismaService } from '../prisma.service.js';
import { StreamCursorService } from '../stream-cursor.service.js';
import type { ThoughtStepStatus } from './chat-entries.types.js';
import { ChatEntriesBaseRepo } from './chat-entries-base.repo.js';

// Max ids per `IN (...)` query; SQLite caps bound variables per statement.
const ID_IN_CHUNK = 500;

// SQL predicate selecting entries that carry streamed LLM token usage. The
// `thought_stream_unify` migration collapsed the per-stage `*_llm_stream` types
// (planner_llm_stream, title_llm_stream, …) into a single `thought_stream`
// type; older rows keep the legacy names, so match both. Token aggregation
// downstream still drops any matched row that lacks a model or usage.
const STREAM_USAGE_TYPE_SQL = "(type = 'thought_stream' OR type LIKE '%llm_stream%')";

export type ToolInvocationState = ToolInvocationEntry['state'];

export type { ChatEntryDbRow, ChatMessageEntry, ThoughtStepStatus } from './chat-entries.types.js';

@Injectable()
export class ChatEntriesRepo extends ChatEntriesBaseRepo {
  constructor(prisma: PrismaService, cursor: StreamCursorService) {
    super(prisma, cursor);
  }

  async appendUserMessage(
    conversationId: string,
    input: {
      text: string;
      agentId: string;
      llm?: LlmRef;
      modelPresetId?: number;
      parentId: string | null;
      attachments?: ChatAttachment[];
      overrides?: UserMessageOverrides;
    },
  ): Promise<UserMessageEntry> {
    const payload: Record<string, unknown> = { text: input.text, agentId: input.agentId };
    if (input.llm) payload.llm = input.llm;
    if (input.modelPresetId !== undefined) payload.modelPresetId = input.modelPresetId;
    if (input.attachments && input.attachments.length > 0) payload.attachments = input.attachments;
    if (input.overrides) payload.overrides = input.overrides;
    const row = await this.appendEntry(conversationId, {
      type: 'user-message',
      parentId: input.parentId,
      payload,
    });
    const result: UserMessageEntry = {
      type: 'user-message',
      id: row.id,
      conversationIndex: row.conversationIndex,
      createdAt: row.createdAt,
      parentId: row.parentId,
      text: input.text,
      agentId: input.agentId,
    };
    if (input.llm) result.llm = input.llm;
    if (input.modelPresetId !== undefined) result.modelPresetId = input.modelPresetId;
    if (input.attachments && input.attachments.length > 0) result.attachments = input.attachments;
    if (input.overrides) result.overrides = input.overrides;
    return result;
  }

  async appendAssistantMessage(
    conversationId: string,
    input: { text: string; parentId: string | null },
  ): Promise<AssistantMessageEntry> {
    const row = await this.appendEntry(conversationId, {
      type: 'assistant-message',
      parentId: input.parentId,
      payload: { text: input.text },
    });
    return {
      type: 'assistant-message',
      id: row.id,
      conversationIndex: row.conversationIndex,
      createdAt: row.createdAt,
      parentId: row.parentId,
      text: input.text,
    };
  }

  async appendThoughtPrepareEntry(
    conversationId: string,
    input: {
      thoughtId: string;
      parentId: string | null;
      status?: ThoughtStepStatus;
      requestText?: string;
      title?: string;
      llm?: LlmRef;
    },
  ): Promise<{ id: string }> {
    const payload: Record<string, unknown> = {
      thoughtId: input.thoughtId,
      requestText: input.requestText ?? '',
      status: input.status ?? 'running',
    };
    if (input.title) payload.title = input.title;
    if (input.llm) payload.llm = input.llm;
    const row = await this.appendEntry(conversationId, {
      type: 'thought-prepare',
      parentId: input.parentId,
      payload,
    });
    return { id: row.id };
  }

  async appendThoughtStreamEntry(
    conversationId: string,
    input: {
      thoughtType: ThoughtType;
      thoughtId: string;
      parentId: string | null;
      status?: ThoughtStepStatus;
      llm?: LlmRef;
      llmRequest?: string;
      /**
       * Thought-type-specific payload fields that the mapper *requires* to be
       * present for this `thoughtType` (e.g. `attachmentId` for
       * `summarize_attachment`). These MUST be written in the initial insert:
       * a snapshot read landing between insert and a later merge would
       * otherwise see a typed-but-incomplete entry and fail to deserialize.
       */
      extra?: Record<string, unknown>;
    },
  ): Promise<{ id: string }> {
    const payload: Record<string, unknown> = {
      thoughtId: input.thoughtId,
      thoughtType: input.thoughtType,
      llmRequest: input.llmRequest ?? '',
      llmResponse: '',
      thoughtMs: null,
      decision: null,
      status: input.status ?? 'running',
      ...(input.extra ?? {}),
    };
    if (input.llm) payload.llm = input.llm;
    const row = await this.appendEntry(conversationId, {
      type: 'thought_stream',
      parentId: input.parentId,
      payload,
    });
    return { id: row.id };
  }

  async appendCheckpointSummary(
    conversationId: string,
    input: {
      parentId: string | null;
      summarizedRange: { fromEntryId: string; toEntryId: string };
      summaryText: string;
      rangeEntryCount?: number;
      rangeInputTokens?: number;
      summaryTokens?: number;
    },
  ): Promise<{ id: string; parentId: string | null; conversationIndex: number; createdAt: string }> {
    const payload: Record<string, unknown> = {
      summarizedRange: input.summarizedRange,
      summaryText: input.summaryText,
    };
    if (input.rangeEntryCount !== undefined) payload.rangeEntryCount = input.rangeEntryCount;
    if (input.rangeInputTokens !== undefined) payload.rangeInputTokens = input.rangeInputTokens;
    if (input.summaryTokens !== undefined) payload.summaryTokens = input.summaryTokens;
    const row = await this.appendEntry(conversationId, {
      type: 'checkpoint-summary',
      parentId: input.parentId,
      payload,
    });
    return row;
  }

  async appendContextInjection(
    conversationId: string,
    input: {
      parentId: string | null;
      files: PreinjectedFileRecord[];
      content: string;
    },
  ): Promise<{ id: string }> {
    const row = await this.appendEntry(conversationId, {
      type: 'context-injection',
      parentId: input.parentId,
      payload: { files: input.files, content: input.content },
    });
    return { id: row.id };
  }

  async appendThoughtActionEntry(
    conversationId: string,
    input: {
      thoughtId: string;
      parentId: string | null;
      status?: ThoughtStepStatus;
      summary?: string;
    },
  ): Promise<{ id: string }> {
    const payload: Record<string, unknown> = {
      thoughtId: input.thoughtId,
      status: input.status ?? 'running',
    };
    if (input.summary) payload.summary = input.summary;
    const row = await this.appendEntry(conversationId, {
      type: 'thought-action',
      parentId: input.parentId,
      payload,
    });
    return { id: row.id };
  }

  async updateThoughtAction(
    conversationId: string,
    entryId: string,
    patch: {
      status?: ThoughtStepStatus;
      summary?: string;
      action?: string;
      toolName?: string;
      error?: string;
    },
  ): Promise<void> {
    const row = await this.fetchEntryRow(conversationId, entryId);
    if (!row || row.type !== 'thought-action') {
      throw new Error(`thought-action entry not found: ${entryId}`);
    }
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    if (patch.status) payload.status = patch.status;
    if (patch.summary !== undefined) payload.summary = patch.summary;
    if (patch.action !== undefined) payload.action = patch.action;
    if (patch.toolName !== undefined) payload.toolName = patch.toolName;
    if (patch.error !== undefined) payload.error = patch.error;
    await this.mutateEntry({
      sql: `UPDATE chat_entries SET payload_json = ? WHERE conversation_id = ? AND id = ? AND type = 'thought-action'`,
      args: [JSON.stringify(payload), conversationId, entryId],
    });
  }

  async appendToolInvocation(
    conversationId: string,
    input: {
      toolId: string;
      state: ToolInvocationState;
      parameters: Record<string, unknown>;
      result?: unknown;
      parentId: string | null;
    },
  ): Promise<{ id: string; parentId: string | null }> {
    const payload: Record<string, unknown> = {
      toolId: input.toolId,
      state: input.state,
      parameters: input.parameters,
      result: input.result ?? null,
    };
    const row = await this.appendEntry(conversationId, {
      type: 'tool-invocation',
      parentId: input.parentId,
      payload,
    });
    return { id: row.id, parentId: row.parentId };
  }

  async updateToolInvocation(
    conversationId: string,
    input: { id: string; state: ToolInvocationState; result?: unknown; parameters?: Record<string, unknown> },
  ): Promise<void> {
    const patch: Record<string, unknown> = { state: input.state };
    if (input.result !== undefined) patch.result = input.result;
    if (input.attempt !== undefined) patch.attempt = input.attempt;
    if (input.parameters !== undefined) patch.parameters = input.parameters;
    await this.mergeEntryPayload(conversationId, input.id, patch);
  }

  /**
   * Non-terminal (`requested` / `running`) tool invocations of one planner
   * fan-out batch, straight from the chat history — the durable source of
   * truth for "are there still pending tools before planning resumes".
   */
  async countPendingToolInvocationsInBatch(conversationId: string, batchId: string): Promise<number> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n
       FROM chat_entries
       WHERE conversation_id = ?
         AND type = 'tool-invocation'
         AND json_extract(payload_json, '$.state') IN ('requested', 'running')
         AND json_extract(payload_json, '$.parameters.__tool_batch.id') = ?`,
      conversationId,
      batchId,
    )) as Array<{ n: number | bigint }>;
    return Number(rows[0]?.n ?? 0);
  }

  /** Tool invocations stranded in `running` (their process died) — boot-sweep input. */
  async listRunningToolInvocations(): Promise<Array<{ id: string; conversationId: string; toolId: string }>> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, conversation_id AS conversationId, json_extract(payload_json, '$.toolId') AS toolId
       FROM chat_entries
       WHERE type = 'tool-invocation'
         AND json_extract(payload_json, '$.state') = 'running'`,
    )) as Array<{ id: string; conversationId: string; toolId: string | null }>;
    return rows.map((r) => ({ id: r.id, conversationId: r.conversationId, toolId: r.toolId ?? 'tool' }));
  }

  async updateAssistantMessage(
    conversationId: string,
    input: { id: string; text: string },
  ): Promise<void> {
    const existing = (await this.prisma.$queryRawUnsafe(
      `SELECT 1 AS present
       FROM chat_entries
       WHERE conversation_id = ? AND id = ? AND type = 'assistant-message'
       LIMIT 1`,
      conversationId,
      input.id,
    )) as Array<{ present: number }>;
    if (existing.length === 0) throw new Error(`assistant-message not found: ${input.id}`);
    await this.mutateEntry({
      sql: `UPDATE chat_entries
         SET payload_json = ?
         WHERE conversation_id = ? AND id = ? AND type = 'assistant-message'`,
      args: [JSON.stringify({ text: input.text }), conversationId, input.id],
    });
  }

  /**
   * Re-sum the stored conversation token/cost counters straight from the streamed
   * LLM entries, mirroring exactly what `addTokenUsage` accumulated during the
   * run (raw `promptTokens` / `cachedPromptTokens` / `completionTokens` /
   * `provider_cost`). Used after a split moves entries between conversations so
   * both totals stay truthful.
   */
  async rawTokenTotals(conversationId: string): Promise<{
    promptTokens: number;
    cachedPromptTokens: number;
    completionTokens: number;
    costUsd: number;
    costPartial: boolean;
  }> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT payload_json
       FROM chat_entries
       WHERE conversation_id = ? AND ${STREAM_USAGE_TYPE_SQL}`,
      conversationId,
    )) as Array<{ payload_json: string }>;
    let promptTokens = 0;
    let cachedPromptTokens = 0;
    let completionTokens = 0;
    let costUsd = 0;
    let costPartial = false;
    for (const row of rows) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      } catch {
        continue;
      }
      const p = payload.promptTokens;
      const c = payload.cachedPromptTokens;
      const comp = payload.completionTokens;
      if (typeof p === 'number' && Number.isFinite(p)) promptTokens += Math.trunc(p);
      if (typeof c === 'number' && Number.isFinite(c)) cachedPromptTokens += Math.trunc(c);
      if (typeof comp === 'number' && Number.isFinite(comp)) completionTokens += Math.trunc(comp);
      const cost = payload.provider_cost;
      const isBillableTurn = (typeof p === 'number' && p > 0) || (typeof comp === 'number' && comp > 0);
      if (typeof cost === 'number' && Number.isFinite(cost)) {
        costUsd += cost;
      } else if (isBillableTurn) {
        costPartial = true;
      }
    }
    return { promptTokens, cachedPromptTokens, completionTokens, costUsd, costPartial };
  }

  async tokenUsageByModel(conversationId: string): Promise<ConversationRow['tokenUsageByModel']> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT payload_json
       FROM chat_entries
       WHERE conversation_id = ? AND ${STREAM_USAGE_TYPE_SQL}`,
      conversationId,
    )) as Array<{ payload_json: string }>;
    return aggregateTokenUsageByModel(toStreamPayloads(rows.map((row) => row.payload_json)));
  }

  /**
   * Bulk variant of {@link tokenUsageByModel} for list endpoints: a single
   * query across all conversation ids, aggregated per conversation. Avoids the
   * per-conversation N+1 the sidebar/list otherwise triggers. Conversations
   * with no stream entries are simply absent from the map (callers default to []).
   */
  async tokenUsageByModelByIds(
    ids: string[],
  ): Promise<Map<string, ConversationRow['tokenUsageByModel']>> {
    const map = new Map<string, ConversationRow['tokenUsageByModel']>();
    if (ids.length === 0) return map;
    const byConversation = new Map<string, string[]>();
    for (let i = 0; i < ids.length; i += ID_IN_CHUNK) {
      const part = ids.slice(i, i + ID_IN_CHUNK);
      const placeholders = part.map(() => '?').join(', ');
      const rows = (await this.prisma.$queryRawUnsafe(
        `SELECT conversation_id AS conversationId, payload_json
         FROM chat_entries
         WHERE conversation_id IN (${placeholders}) AND ${STREAM_USAGE_TYPE_SQL}`,
        ...part,
      )) as Array<{ conversationId: string; payload_json: string }>;
      for (const row of rows) {
        const list = byConversation.get(row.conversationId);
        if (list) list.push(row.payload_json);
        else byConversation.set(row.conversationId, [row.payload_json]);
      }
    }
    for (const [conversationId, payloads] of byConversation) {
      map.set(conversationId, aggregateTokenUsageByModel(toStreamPayloads(payloads)));
    }
    return map;
  }
}

/** Parse llm_stream payload_json blobs, keeping only those that name a model. */
function toStreamPayloads(
  payloadJsons: string[],
): Array<{ modelName: string; payload: Record<string, unknown> }> {
  const streamPayloads: Array<{ modelName: string; payload: Record<string, unknown> }> = [];
  for (const json of payloadJsons) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const llm = payload.llm;
    const modelName =
      llm && typeof llm === 'object' && !Array.isArray(llm)
        ? String((llm as { model?: unknown }).model ?? '').trim()
        : '';
    if (!modelName) continue;
    streamPayloads.push({ modelName, payload });
  }
  return streamPayloads;
}
