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
import type { RetrievalHit, RetrievalQuery } from '../../contracts/retrieval.js';
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
      isSide: false,
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
      isSide: false,
      text: input.text,
    };
  }

  async appendThoughtPrepareEntry(
    conversationId: string,
    input: {
      thoughtId: string;
      parentId: string | null;
      isSide?: boolean;
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
      isSide: input.isSide,
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
      isSide?: boolean;
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
      isSide: input.isSide,
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

  /**
   * Start a forced-retrieval record (state 'pending'). The payload is
   * schema-complete from this first insert — `hits` starts empty and the
   * done/failed update only fills optionals — so a snapshot read landing
   * mid-retrieval always maps.
   */
  async appendRetrievalEntry(
    conversationId: string,
    input: {
      parentId: string | null;
      source: 'rag';
      queries: RetrievalQuery[];
      storages: string[];
    },
  ): Promise<{ id: string }> {
    const row = await this.appendEntry(conversationId, {
      type: 'retrieval',
      parentId: input.parentId,
      payload: {
        source: input.source,
        state: 'pending',
        queries: input.queries,
        storages: input.storages,
        hits: [],
      },
    });
    return { id: row.id };
  }

  /** Resolve a pending retrieval entry to done (with hits) or failed. */
  async completeRetrievalEntry(
    conversationId: string,
    entryId: string,
    result: { hits: RetrievalHit[] } | { error: string },
  ): Promise<void> {
    await this.mergeEntryPayload(
      conversationId,
      entryId,
      'hits' in result ? { state: 'done', hits: result.hits } : { state: 'failed', error: result.error },
    );
  }

  async appendThoughtActionEntry(
    conversationId: string,
    input: {
      thoughtId: string;
      parentId: string | null;
      isSide?: boolean;
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
      isSide: input.isSide,
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
    const payloadJson = JSON.stringify(payload);
    this.assertServableRow({ ...row, payload_json: payloadJson });
    await this.mutateEntry({
      sql: `UPDATE chat_entries SET payload_json = ? WHERE conversation_id = ? AND id = ? AND type = 'thought-action'`,
      args: [payloadJson, conversationId, entryId],
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
    input: {
      id: string;
      state: ToolInvocationState;
      result?: unknown;
      attempt?: number;
      parameters?: Record<string, unknown>;
    },
  ): Promise<void> {
    const patch: Record<string, unknown> = { state: input.state };
    if (input.result !== undefined) patch.result = input.result;
    if (input.attempt !== undefined) patch.attempt = input.attempt;
    if (input.parameters !== undefined) patch.parameters = input.parameters;
    await this.mergeEntryPayload(conversationId, input.id, patch);
  }

  /**
   * Terminal (`done` / `error` / `denied`) tool invocations of one planner
   * fan-out batch, straight from the chat history — the durable source of
   * truth for "has every member resolved before planning resumes". Counting
   * TERMINAL entries against the batch's stamped size (instead of counting
   * pending ones) makes the fan-in safe against a member failing before its
   * siblings' entries are even inserted: not-yet-persisted members simply
   * haven't reached the terminal count.
   */
  async countTerminalToolInvocationsInBatch(conversationId: string, batchId: string): Promise<number> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n
       FROM chat_entries
       WHERE conversation_id = ?
         AND type = 'tool-invocation'
         AND json_extract(payload_json, '$.state') IN ('done', 'error', 'denied')
         AND json_extract(payload_json, '$.parameters.__tool_batch.id') = ?`,
      conversationId,
      batchId,
    )) as Array<{ n: number | bigint }>;
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * The batch's chain tail: its last member in chain order. Members are
   * pre-created back-to-back by the dispatching planner, so the highest
   * conversation_index among them is the tail. The post-batch planner
   * continuation anchors here — never at whichever member settled last.
   */
  async resolveBatchTailEntryId(conversationId: string, batchId: string): Promise<string | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id FROM chat_entries
       WHERE conversation_id = ?
         AND type = 'tool-invocation'
         AND json_extract(payload_json, '$.parameters.__tool_batch.id') = ?
       ORDER BY conversation_index DESC
       LIMIT 1`,
      conversationId,
      batchId,
    )) as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  }

  /** Whether the entry already has a spine (branch-participating) child. */
  async hasSpineChild(conversationId: string, entryId: string): Promise<boolean> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT 1 AS present FROM chat_entries
       WHERE conversation_id = ? AND parent_id = ? AND is_side = 0
       LIMIT 1`,
      conversationId,
      entryId,
    )) as Array<{ present: number }>;
    return rows.length > 0;
  }

  /** Thought entries stranded in `running` (their process died) — boot-sweep input. */
  async listRunningThoughtEntries(): Promise<Array<{ id: string; conversationId: string; type: string }>> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, conversation_id AS conversationId, type
       FROM chat_entries
       WHERE type IN ('thought-prepare', 'thought_stream', 'thought-action')
         AND json_extract(payload_json, '$.status') = 'running'`,
    )) as Array<{ id: string; conversationId: string; type: string }>;
    return rows;
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
    const row = await this.fetchEntryRow(conversationId, input.id);
    if (!row || row.type !== 'assistant-message') {
      throw new Error(`assistant-message not found: ${input.id}`);
    }
    const payloadJson = JSON.stringify({ text: input.text });
    this.assertServableRow({ ...row, payload_json: payloadJson });
    await this.mutateEntry({
      sql: `UPDATE chat_entries
         SET payload_json = ?
         WHERE conversation_id = ? AND id = ? AND type = 'assistant-message'`,
      args: [payloadJson, conversationId, input.id],
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
