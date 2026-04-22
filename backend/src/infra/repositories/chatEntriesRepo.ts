import type {
  ChatAttachment,
  ChatEntry,
  ThoughtActionEntry,
  ThoughtPrepareEntry,
  PlannerLlmStreamEntry,
  TitleLlmStreamEntry,
  ToolInvocationEntry,
  AssistantMessageEntry,
  LlmDecision,
  UserMessageEntry,
  UserMessageSelection,
} from "../../types/chatEntry.js";
import {
  normalizeUserMessageSelection,
  userMessageAttachmentsFromPayload,
  userMessageSelectionFromPayload,
} from "../../types/chatEntry.js";
import type { SqliteDb } from "../db/client.js";
import { parseJsonObject } from "./json.js";

type ChatEntryDbRow = {
  id: string;
  conversation_id: string;
  conversation_index: number;
  parent_id: string | null;
  type: string;
  payload_json: string;
  created_at: string;
};

export type ConversationModelTokenUsageRow = {
  conversation_id: string;
  model_name: string;
  prompt_tokens: number;
  cached_prompt_tokens: number;
  completion_tokens: number;
};

export class ChatEntriesRepo {
  constructor(private readonly db: SqliteDb) {}

  private getActiveLeafEntryId(conversationId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT active_leaf_entry_id
         FROM conversations
         WHERE id = ?`,
      )
      .get(conversationId) as { active_leaf_entry_id?: string | null } | undefined;
    return typeof row?.active_leaf_entry_id === "string" && row.active_leaf_entry_id.trim() !== ""
      ? row.active_leaf_entry_id
      : null;
  }

  private setActiveLeafEntryId(conversationId: string, entryId: string | null): void {
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET active_leaf_entry_id = @entry_id
         WHERE id = @conversation_id`,
      )
      .run({
        conversation_id: conversationId,
        entry_id: entryId,
      });
    if (Number(result.changes ?? 0) !== 1) {
      throw new Error(`conversation not found when setting active leaf: ${conversationId}`);
    }
  }

  setActiveLeafEntry(conversationId: string, entryId: string): void {
    const normalizedEntryId = String(entryId || "").trim();
    if (!normalizedEntryId) {
      throw new Error("entryId is required");
    }
    const row = this.db
      .prepare(
        `SELECT 1 AS is_present
         FROM chat_entries
         WHERE conversation_id = ?
           AND id = ?
         LIMIT 1`,
      )
      .get(conversationId, normalizedEntryId) as { is_present?: number } | undefined;
    if (row?.is_present !== 1) {
      throw new Error(`entry not found in conversation: ${normalizedEntryId}`);
    }
    this.setActiveLeafEntryId(conversationId, normalizedEntryId);
  }

  private resolveParentId(conversationId: string, parentId?: string | null): string | null {
    if (typeof parentId === "string" && parentId.trim() !== "") {
      return parentId.trim();
    }
    return this.getActiveLeafEntryId(conversationId);
  }

  private insertEntry(input: {
    id: string;
    conversationId: string;
    conversationIndex: number;
    parentId: string | null;
    type: string;
    payloadJson: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO chat_entries (
           id, conversation_id, conversation_index, parent_id, type, payload_json, created_at
         ) VALUES (
           @id, @conversation_id, @conversation_index, @parent_id, @type, @payload_json, @created_at
         )`,
      )
      .run({
        id: input.id,
        conversation_id: input.conversationId,
        conversation_index: input.conversationIndex,
        parent_id: input.parentId,
        type: input.type,
        payload_json: input.payloadJson,
        created_at: input.createdAt,
      });
    this.setActiveLeafEntryId(input.conversationId, input.id);
  }

  private nextConversationIndex(conversationId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(conversation_index), -1) AS max_idx
         FROM chat_entries
         WHERE conversation_id = ?`,
      )
      .get(conversationId) as { max_idx?: number } | undefined;
    return Number(row?.max_idx ?? -1) + 1;
  }

  countEntries(conversationId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(1) AS cnt
         FROM chat_entries
         WHERE conversation_id = ?`,
      )
      .get(conversationId) as { cnt?: number } | undefined;
    return Number(row?.cnt ?? 0);
  }

  listConversationTokenUsageByModel(): ConversationModelTokenUsageRow[] {
    const rows = this.db
      .prepare(
        `SELECT
           e.conversation_id AS conversation_id,
           TRIM(CAST(json_extract(e.payload_json, '$.llmModel') AS TEXT)) AS model_name,
           SUM(COALESCE(CAST(json_extract(e.payload_json, '$.promptTokens') AS INTEGER), 0)) AS prompt_tokens,
           SUM(COALESCE(CAST(json_extract(e.payload_json, '$.cachedPromptTokens') AS INTEGER), 0)) AS cached_prompt_tokens,
           SUM(COALESCE(CAST(json_extract(e.payload_json, '$.completionTokens') AS INTEGER), 0)) AS completion_tokens
         FROM chat_entries e
         WHERE e.type IN ('planner_llm_stream', 'title_llm_stream')
         GROUP BY e.conversation_id, model_name`,
      )
      .all() as Array<{
      conversation_id: string;
      model_name: string | null;
      prompt_tokens: number | null;
      cached_prompt_tokens: number | null;
      completion_tokens: number | null;
    }>;
    return rows
      .map((row) => ({
        conversation_id: row.conversation_id,
        model_name: String(row.model_name || "").trim(),
        prompt_tokens:
          typeof row.prompt_tokens === "number" && Number.isFinite(row.prompt_tokens) ? row.prompt_tokens : 0,
        cached_prompt_tokens:
          typeof row.cached_prompt_tokens === "number" && Number.isFinite(row.cached_prompt_tokens)
            ? row.cached_prompt_tokens
            : 0,
        completion_tokens:
          typeof row.completion_tokens === "number" && Number.isFinite(row.completion_tokens)
            ? row.completion_tokens
            : 0,
      }))
      .filter((row) => row.model_name.length > 0);
  }

  appendUserMessage(
    conversationId: string,
    text: string,
    opts: UserMessageSelection & { attachments?: ChatAttachment[]; parentId?: string | null },
  ): UserMessageEntry {
    const createDbEntryPayload = normalizeUserMessageSelection(opts);
    const attachments = Array.isArray(opts?.attachments) ? opts.attachments : [];
    const createdAt = new Date().toISOString();
    const parentId = this.resolveParentId(conversationId, opts.parentId);
    const entry: UserMessageEntry = {
      type: "user-message",
      id: crypto.randomUUID(),
      conversationIndex: this.nextConversationIndex(conversationId),
      createdAt,
      parentId,
      text,
      ...createDbEntryPayload,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
    this.insertEntry({
      id: entry.id,
      conversationId,
      conversationIndex: entry.conversationIndex,
      parentId: entry.parentId,
      type: entry.type,
      payloadJson: JSON.stringify({
        text: entry.text,
        ...createDbEntryPayload,
        ...(attachments.length > 0 ? { attachments } : {}),
      }),
      createdAt: entry.createdAt,
    });
    return entry;
  }

  appendAssistantMessage(
    conversationId: string,
    text: string,
    opts?: { id?: string; createdAt?: string; parentId?: string | null },
  ): AssistantMessageEntry {
    const createdAt = opts?.createdAt ?? new Date().toISOString();
    const parentId = this.resolveParentId(conversationId, opts?.parentId);
    const entry: AssistantMessageEntry = {
      type: "assistant-message",
      id: opts?.id ?? crypto.randomUUID(),
      conversationIndex: this.nextConversationIndex(conversationId),
      createdAt,
      parentId,
      text,
    };
    this.insertEntry({
      id: entry.id,
      conversationId,
      conversationIndex: entry.conversationIndex,
      parentId: entry.parentId,
      type: entry.type,
      payloadJson: JSON.stringify({ text: entry.text }),
      createdAt: entry.createdAt,
    });
    return entry;
  }

  updateAssistantMessage(conversationId: string, input: { id: string; text: string }): void {
    const result = this.db
      .prepare(
        `UPDATE chat_entries
         SET payload_json = @payload_json
         WHERE id = @id
           AND conversation_id = @conversation_id
           AND type = 'assistant-message'`,
      )
      .run({
        id: input.id,
        conversation_id: conversationId,
        payload_json: JSON.stringify({ text: input.text }),
      });
    if (Number(result.changes ?? 0) !== 1) {
      throw new Error(`assistant-message entry not found for update: conversation=${conversationId} id=${input.id}`);
    }
  }

  appendToolInvocation(
    conversationId: string,
    input: {
      id?: string;
      createdAt?: string;
      parentId?: string | null;
      toolId: string;
      state: ToolInvocationEntry["state"];
      parameters?: Record<string, unknown>;
      result?: unknown;
    },
  ): ToolInvocationEntry {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const parentId = this.resolveParentId(conversationId, input.parentId);
    const entry: ToolInvocationEntry = {
      type: "tool-invocation",
      id: input.id ?? crypto.randomUUID(),
      conversationIndex: this.nextConversationIndex(conversationId),
      createdAt,
      parentId,
      toolId: input.toolId,
      state: input.state,
      parameters: input.parameters ?? {},
      result: input.result ?? null,
    };
    this.insertEntry({
      id: entry.id,
      conversationId,
      conversationIndex: entry.conversationIndex,
      parentId: entry.parentId,
      type: entry.type,
      payloadJson: JSON.stringify({
        toolId: entry.toolId,
        state: entry.state,
        parameters: entry.parameters,
        result: entry.result,
      }),
      createdAt: entry.createdAt,
    });
    return entry;
  }

  updateToolInvocation(
    conversationId: string,
    input: {
      id: string;
      state: ToolInvocationEntry["state"];
      result: unknown;
    },
  ): void {
    const row = this.db
      .prepare(
        `SELECT payload_json
         FROM chat_entries
         WHERE id = ? AND conversation_id = ? AND type = 'tool-invocation'`,
      )
      .get(input.id, conversationId) as { payload_json?: string } | undefined;
    if (!row?.payload_json) {
      throw new Error(`tool-invocation entry not found for update: conversation=${conversationId} id=${input.id}`);
    }
    const payload = parseJsonObject(row.payload_json);
    this.db
      .prepare(
        `UPDATE chat_entries
         SET payload_json = @payload_json
         WHERE id = @id
           AND conversation_id = @conversation_id
           AND type = 'tool-invocation'`,
      )
      .run({
        id: input.id,
        conversation_id: conversationId,
        payload_json: JSON.stringify({
          toolId: String(payload.toolId ?? ""),
          state: input.state,
          parameters: payload.parameters && typeof payload.parameters === "object" ? payload.parameters : {},
          result: input.result,
        }),
      });
  }

  appendPlannerLlmStreamEntry(
    conversationId: string,
    input: {
      id: string;
      createdAt: string;
      parentId?: string | null;
      llmRequest: string;
      llmResponse?: string;
      thoughtMs?: number | null;
      decision?: LlmDecision | null;
      status?: "running" | "completed" | "failed" | "cancelled";
      error?: string;
      llmModel?: string;
    },
  ): PlannerLlmStreamEntry {
    const conversationIndex = this.nextConversationIndex(conversationId);
    const parentId = this.resolveParentId(conversationId, input.parentId);
    const llmModelRaw = typeof input.llmModel === "string" ? input.llmModel.trim() : "";
    const llmModel = llmModelRaw.length > 0 ? llmModelRaw : undefined;
    const entry: PlannerLlmStreamEntry = {
      type: "planner_llm_stream",
      id: input.id,
      conversationIndex,
      createdAt: input.createdAt,
      parentId,
      llmRequest: input.llmRequest,
      llmResponse: input.llmResponse ?? "",
      thoughtMs: input.thoughtMs ?? null,
      decision: input.decision ?? null,
      status: input.status ?? "running",
      ...(input.error ? { error: input.error } : {}),
      ...(llmModel !== undefined ? { llmModel } : {}),
    };
    const payload: Record<string, unknown> = {
      llmRequest: entry.llmRequest,
      llmResponse: entry.llmResponse ?? "",
      thoughtMs: entry.thoughtMs ?? null,
      decision: entry.decision ?? null,
      status: entry.status ?? "running",
      ...(entry.error ? { error: entry.error } : {}),
    };
    if (llmModel !== undefined) payload.llmModel = llmModel;
    this.insertEntry({
      id: entry.id,
      conversationId,
      conversationIndex: entry.conversationIndex,
      parentId: entry.parentId,
      type: "planner_llm_stream",
      payloadJson: JSON.stringify(payload),
      createdAt: entry.createdAt,
    });
    return entry;
  }

  appendThoughtPrepareEntry(
    conversationId: string,
    input: {
      id: string;
      createdAt: string;
      parentId?: string | null;
      requestText: string;
      llmModel?: string;
    },
  ): ThoughtPrepareEntry {
    const conversationIndex = this.nextConversationIndex(conversationId);
    const parentId = this.resolveParentId(conversationId, input.parentId);
    const llmModelRaw = typeof input.llmModel === "string" ? input.llmModel.trim() : "";
    const llmModel = llmModelRaw.length > 0 ? llmModelRaw : undefined;
    const entry: ThoughtPrepareEntry = {
      type: "thought-prepare",
      id: input.id,
      conversationIndex,
      createdAt: input.createdAt,
      parentId,
      requestText: input.requestText,
      status: "completed",
      ...(llmModel !== undefined ? { llmModel } : {}),
    };
    const payload: Record<string, unknown> = {
      requestText: entry.requestText,
      status: "completed",
    };
    if (llmModel !== undefined) payload.llmModel = llmModel;
    this.insertEntry({
      id: entry.id,
      conversationId,
      conversationIndex: entry.conversationIndex,
      parentId: entry.parentId,
      type: "thought-prepare",
      payloadJson: JSON.stringify(payload),
      createdAt: entry.createdAt,
    });
    return entry;
  }

  appendThoughtActionEntry(
    conversationId: string,
    input: {
      id: string;
      createdAt: string;
      parentId?: string | null;
      status: ThoughtActionEntry["status"];
      summary?: string;
      action?: string;
      toolName?: string;
      error?: string;
      parseResult?: ThoughtActionEntry["parseResult"];
    },
  ): ThoughtActionEntry {
    const conversationIndex = this.nextConversationIndex(conversationId);
    const parentId = this.resolveParentId(conversationId, input.parentId);
    const summary = typeof input.summary === "string" ? input.summary : undefined;
    const action = typeof input.action === "string" ? input.action : undefined;
    const toolName = typeof input.toolName === "string" ? input.toolName : undefined;
    const error = typeof input.error === "string" ? input.error : undefined;
    const parseResult = input.parseResult && typeof input.parseResult === "object" ? input.parseResult : undefined;
    const entry: ThoughtActionEntry = {
      type: "thought-action",
      id: input.id,
      conversationIndex,
      createdAt: input.createdAt,
      parentId,
      status: input.status,
      ...(summary ? { summary } : {}),
      ...(action ? { action } : {}),
      ...(toolName ? { toolName } : {}),
      ...(error ? { error } : {}),
      ...(parseResult ? { parseResult } : {}),
    };
    this.insertEntry({
      id: entry.id,
      conversationId,
      conversationIndex: entry.conversationIndex,
      parentId: entry.parentId,
      type: "thought-action",
      payloadJson: JSON.stringify({
        status: entry.status,
        ...(summary ? { summary } : {}),
        ...(action ? { action } : {}),
        ...(toolName ? { toolName } : {}),
        ...(error ? { error } : {}),
        ...(parseResult ? { parseResult } : {}),
      }),
      createdAt: entry.createdAt,
    });
    return entry;
  }

  updateThoughtActionEntry(
    conversationId: string,
    input: {
      id: string;
      status: ThoughtActionEntry["status"];
      summary?: string;
      action?: string;
      toolName?: string;
      error?: string;
      parseResult?: ThoughtActionEntry["parseResult"];
    },
  ): void {
    const payload: Record<string, unknown> = {
      status: input.status,
      ...(typeof input.summary === "string" ? { summary: input.summary } : {}),
      ...(typeof input.action === "string" ? { action: input.action } : {}),
      ...(typeof input.toolName === "string" ? { toolName: input.toolName } : {}),
      ...(typeof input.error === "string" ? { error: input.error } : {}),
      ...(input.parseResult && typeof input.parseResult === "object" ? { parseResult: input.parseResult } : {}),
    };
    const result = this.db
      .prepare(
        `UPDATE chat_entries
         SET payload_json = @payload_json
         WHERE id = @id
           AND conversation_id = @conversation_id
           AND type = 'thought-action'`,
      )
      .run({
        id: input.id,
        conversation_id: conversationId,
        payload_json: JSON.stringify(payload),
      });
    if (Number(result.changes ?? 0) !== 1) {
      throw new Error(`thought-action entry not found for update: conversation=${conversationId} id=${input.id}`);
    }
  }

  appendTitleLlmStreamEntry(
    conversationId: string,
    input: {
      id: string;
      createdAt: string;
      parentId?: string | null;
      llmRequest: string;
      llmResponse?: string;
      thoughtMs?: number | null;
      decision?: LlmDecision | null;
      status?: "running" | "completed" | "failed" | "cancelled";
      error?: string;
      llmModel?: string;
    },
  ): TitleLlmStreamEntry {
    const conversationIndex = this.nextConversationIndex(conversationId);
    const parentId = this.resolveParentId(conversationId, input.parentId);
    const llmModelRaw = typeof input.llmModel === "string" ? input.llmModel.trim() : "";
    const llmModel = llmModelRaw.length > 0 ? llmModelRaw : undefined;
    const entry: TitleLlmStreamEntry = {
      type: "title_llm_stream",
      id: input.id,
      conversationIndex,
      createdAt: input.createdAt,
      parentId,
      llmRequest: input.llmRequest,
      llmResponse: input.llmResponse ?? "",
      thoughtMs: input.thoughtMs ?? null,
      decision: input.decision ?? null,
      status: input.status ?? "running",
      ...(input.error ? { error: input.error } : {}),
      ...(llmModel !== undefined ? { llmModel } : {}),
    };
    const payload: Record<string, unknown> = {
      llmRequest: entry.llmRequest,
      llmResponse: entry.llmResponse ?? "",
      thoughtMs: entry.thoughtMs ?? null,
      decision: entry.decision ?? null,
      status: entry.status ?? "running",
      ...(entry.error ? { error: entry.error } : {}),
    };
    if (llmModel !== undefined) payload.llmModel = llmModel;
    this.insertEntry({
      id: entry.id,
      conversationId,
      conversationIndex: entry.conversationIndex,
      parentId: entry.parentId,
      type: "title_llm_stream",
      payloadJson: JSON.stringify(payload),
      createdAt: entry.createdAt,
    });
    return entry;
  }

  updatePlannerLlmStreamEntry(
    conversationId: string,
    input: {
      id: string;
      llmRequest: string;
      llmResponse?: string;
      thoughtMs?: number | null;
      decision?: LlmDecision | null;
      status?: "running" | "completed" | "failed" | "cancelled";
      error?: string;
      llmModel?: string;
      promptTokens?: number;
      cachedPromptTokens?: number;
      completionTokens?: number;
      parseResult?: PlannerLlmStreamEntry["parseResult"];
    },
  ): void {
    const llmModelRaw = typeof input.llmModel === "string" ? input.llmModel.trim() : "";
    const llmModel = llmModelRaw.length > 0 ? llmModelRaw : undefined;
    const payload: Record<string, unknown> = {
      llmRequest: input.llmRequest,
      llmResponse: input.llmResponse ?? "",
      thoughtMs: input.thoughtMs ?? null,
      decision: input.decision ?? null,
      status: input.status ?? "running",
      ...(input.error ? { error: input.error } : {}),
    };
    if (llmModel !== undefined) payload.llmModel = llmModel;
    if (typeof input.promptTokens === "number" && Number.isFinite(input.promptTokens)) {
      payload.promptTokens = input.promptTokens;
    }
    if (typeof input.cachedPromptTokens === "number" && Number.isFinite(input.cachedPromptTokens)) {
      payload.cachedPromptTokens = input.cachedPromptTokens;
    }
    if (typeof input.completionTokens === "number" && Number.isFinite(input.completionTokens)) {
      payload.completionTokens = input.completionTokens;
    }
    if (input.parseResult && typeof input.parseResult === "object") {
      payload.parseResult = input.parseResult;
    }
    const result = this.db
      .prepare(
        `UPDATE chat_entries
         SET payload_json = @payload_json
         WHERE id = @id
           AND conversation_id = @conversation_id
           AND type = 'planner_llm_stream'`,
      )
      .run({
        id: input.id,
        conversation_id: conversationId,
        payload_json: JSON.stringify(payload),
      });
    if (Number(result.changes ?? 0) !== 1) {
      throw new Error(`planner_llm_stream entry not found for update: conversation=${conversationId} id=${input.id}`);
    }
  }

  updateTitleLlmStreamEntry(
    conversationId: string,
    input: {
      id: string;
      llmRequest: string;
      llmResponse?: string;
      thoughtMs?: number | null;
      decision?: LlmDecision | null;
      status?: "running" | "completed" | "failed" | "cancelled";
      error?: string;
      llmModel?: string;
      promptTokens?: number;
      cachedPromptTokens?: number;
      completionTokens?: number;
    },
  ): void {
    const llmModelRaw = typeof input.llmModel === "string" ? input.llmModel.trim() : "";
    const llmModel = llmModelRaw.length > 0 ? llmModelRaw : undefined;
    const payload: Record<string, unknown> = {
      llmRequest: input.llmRequest,
      llmResponse: input.llmResponse ?? "",
      thoughtMs: input.thoughtMs ?? null,
      decision: input.decision ?? null,
      status: input.status ?? "running",
      ...(input.error ? { error: input.error } : {}),
    };
    if (llmModel !== undefined) payload.llmModel = llmModel;
    if (typeof input.promptTokens === "number" && Number.isFinite(input.promptTokens)) {
      payload.promptTokens = input.promptTokens;
    }
    if (typeof input.cachedPromptTokens === "number" && Number.isFinite(input.cachedPromptTokens)) {
      payload.cachedPromptTokens = input.cachedPromptTokens;
    }
    if (typeof input.completionTokens === "number" && Number.isFinite(input.completionTokens)) {
      payload.completionTokens = input.completionTokens;
    }
    const result = this.db
      .prepare(
        `UPDATE chat_entries
         SET payload_json = @payload_json
         WHERE id = @id
           AND conversation_id = @conversation_id
           AND type = 'title_llm_stream'`,
      )
      .run({
        id: input.id,
        conversation_id: conversationId,
        payload_json: JSON.stringify(payload),
      });
    if (Number(result.changes ?? 0) !== 1) {
      throw new Error(`title_llm_stream entry not found for update: conversation=${conversationId} id=${input.id}`);
    }
  }

  getLastUserMessage(conversationId: string): UserMessageEntry | null {
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, conversation_index, parent_id, type, payload_json, created_at
         FROM chat_entries
         WHERE conversation_id = ? AND type = 'user-message'
         ORDER BY conversation_index DESC
         LIMIT 1`,
      )
      .get(conversationId) as ChatEntryDbRow | undefined;
    if (!row) return null;
    const payload = parseJsonObject(row.payload_json);
    const selection = userMessageSelectionFromPayload(payload);
    const attachments = userMessageAttachmentsFromPayload(payload);
    return {
      type: "user-message",
      id: row.id,
      conversationIndex: row.conversation_index,
      createdAt: row.created_at,
      parentId: row.parent_id,
      text: String(payload.text ?? ""),
      ...selection,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }

  listMessages(conversationId: string, options?: { activePathOnly?: boolean }): ChatEntry[] {
    const activePathOnly = options?.activePathOnly !== false;
    if (activePathOnly) {
      const activeLeafEntryId = this.getActiveLeafEntryId(conversationId);
      if (!activeLeafEntryId) {
        return this.listMessages(conversationId, { activePathOnly: false });
      }
      const rows = this.db
        .prepare(
          `WITH RECURSIVE lineage AS (
             SELECT id, parent_id
             FROM chat_entries
             WHERE conversation_id = @conversation_id
               AND id = @leaf_id
             UNION ALL
             SELECT e.id, e.parent_id
             FROM chat_entries e
             JOIN lineage l ON l.parent_id = e.id
             WHERE e.conversation_id = @conversation_id
           )
           SELECT e.id, e.conversation_id, e.conversation_index, e.parent_id, e.type, e.payload_json, e.created_at
           FROM chat_entries e
           JOIN lineage l ON l.id = e.id
           WHERE e.conversation_id = @conversation_id
           ORDER BY e.conversation_index ASC`,
        )
        .all({
          conversation_id: conversationId,
          leaf_id: activeLeafEntryId,
        }) as ChatEntryDbRow[];
      if (rows.length === 0) {
        return this.listMessages(conversationId, { activePathOnly: false });
      }
      return rows.map((row) => this.toEntry(row));
    }
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, conversation_index, parent_id, type, payload_json, created_at
         FROM chat_entries
         WHERE conversation_id = ?
         ORDER BY conversation_index ASC`,
      )
      .all(conversationId) as ChatEntryDbRow[];

    return rows.map((row) => this.toEntry(row));
  }

  getMessage(conversationId: string, entryId: string): ChatEntry | null {
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, conversation_index, parent_id, type, payload_json, created_at
         FROM chat_entries
         WHERE conversation_id = ? AND id = ?`,
      )
      .get(conversationId, entryId) as ChatEntryDbRow | undefined;
    return row ? this.toEntry(row) : null;
  }

  isEntryOnActiveLineage(conversationId: string, entryId: string): boolean {
    const activeLeafEntryId = this.getActiveLeafEntryId(conversationId);
    if (!activeLeafEntryId) return false;
    const row = this.db
      .prepare(
        `WITH RECURSIVE lineage AS (
           SELECT id, parent_id
           FROM chat_entries
           WHERE conversation_id = @conversation_id
             AND id = @leaf_id
           UNION ALL
           SELECT e.id, e.parent_id
           FROM chat_entries e
           JOIN lineage l ON l.parent_id = e.id
           WHERE e.conversation_id = @conversation_id
         )
         SELECT 1 AS is_present
         FROM lineage
         WHERE id = @entry_id
         LIMIT 1`,
      )
      .get({
        conversation_id: conversationId,
        leaf_id: activeLeafEntryId,
        entry_id: entryId,
      }) as { is_present?: number } | undefined;
    return row?.is_present === 1;
  }

  private toEntry(row: ChatEntryDbRow): ChatEntry {
    const payload = parseJsonObject(row.payload_json);
      if (row.type === "user-message") {
        const selection = userMessageSelectionFromPayload(payload);
        const attachments = userMessageAttachmentsFromPayload(payload);
        return {
          type: "user-message",
          id: row.id,
          conversationIndex: row.conversation_index,
          createdAt: row.created_at,
          parentId: row.parent_id,
          text: String(payload.text ?? ""),
          ...selection,
          ...(attachments.length > 0 ? { attachments } : {}),
        } satisfies UserMessageEntry;
      }
      if (row.type === "assistant-message") {
        return {
          type: "assistant-message",
          id: row.id,
          conversationIndex: row.conversation_index,
          createdAt: row.created_at,
          parentId: row.parent_id,
          text: String(payload.text ?? ""),
        } satisfies AssistantMessageEntry;
      }
      if (row.type === "planner_llm_stream") {
        const llmModel =
          typeof payload.llmModel === "string" && payload.llmModel.trim() !== "" ? payload.llmModel.trim() : undefined;
        const promptTokens =
          typeof payload.promptTokens === "number" && Number.isFinite(payload.promptTokens)
            ? payload.promptTokens
            : undefined;
        const cachedPromptTokens =
          typeof payload.cachedPromptTokens === "number" && Number.isFinite(payload.cachedPromptTokens)
            ? payload.cachedPromptTokens
            : undefined;
        const completionTokens =
          typeof payload.completionTokens === "number" && Number.isFinite(payload.completionTokens)
            ? payload.completionTokens
            : undefined;
        const status =
          payload.status === "running" ||
          payload.status === "completed" ||
          payload.status === "failed" ||
          payload.status === "cancelled"
            ? payload.status
            : payload.failed === true
              ? "failed"
              : Number.isFinite(payload.thoughtMs as number)
                ? "completed"
                : "running";
        const error = typeof payload.error === "string" && payload.error.trim() !== "" ? payload.error : undefined;
        const parseResult =
          payload.parseResult &&
          typeof payload.parseResult === "object" &&
          (((payload.parseResult as Record<string, unknown>).status === "ok" &&
            (payload.parseResult as Record<string, unknown>).parsed &&
            typeof (payload.parseResult as Record<string, unknown>).parsed === "object") ||
            ((payload.parseResult as Record<string, unknown>).status === "error" &&
              typeof (payload.parseResult as Record<string, unknown>).error === "string"))
            ? (payload.parseResult as PlannerLlmStreamEntry["parseResult"])
            : undefined;
        return {
          type: "planner_llm_stream",
          id: row.id,
          conversationIndex: row.conversation_index,
          createdAt: row.created_at,
          parentId: row.parent_id,
          llmRequest: String(payload.llmRequest ?? ""),
          llmResponse: typeof payload.llmResponse === "string" ? payload.llmResponse : undefined,
          thoughtMs: Number.isFinite(payload.thoughtMs as number) ? (payload.thoughtMs as number) : null,
          decision: payload.decision && typeof payload.decision === "object" ? (payload.decision as LlmDecision) : null,
          status,
          ...(error !== undefined ? { error } : {}),
          ...(llmModel !== undefined ? { llmModel } : {}),
          ...(promptTokens !== undefined ? { promptTokens } : {}),
          ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
          ...(completionTokens !== undefined ? { completionTokens } : {}),
          ...(parseResult !== undefined ? { parseResult } : {}),
        } satisfies PlannerLlmStreamEntry;
      }
      if (row.type === "thought-prepare") {
        const llmModel =
          typeof payload.llmModel === "string" && payload.llmModel.trim() !== "" ? payload.llmModel.trim() : undefined;
        return {
          type: "thought-prepare",
          id: row.id,
          conversationIndex: row.conversation_index,
          createdAt: row.created_at,
          parentId: row.parent_id,
          requestText: String(payload.requestText ?? ""),
          status: "completed",
          ...(llmModel !== undefined ? { llmModel } : {}),
        } satisfies ThoughtPrepareEntry;
      }
      if (row.type === "thought-action") {
        const status =
          payload.status === "running" ||
          payload.status === "completed" ||
          payload.status === "failed" ||
          payload.status === "cancelled"
            ? payload.status
            : "running";
        const summary = typeof payload.summary === "string" ? payload.summary : undefined;
        const action = typeof payload.action === "string" ? payload.action : undefined;
        const toolName = typeof payload.toolName === "string" ? payload.toolName : undefined;
        const error = typeof payload.error === "string" ? payload.error : undefined;
        const parseResult =
          payload.parseResult &&
          typeof payload.parseResult === "object" &&
          (((payload.parseResult as Record<string, unknown>).status === "ok" &&
            (payload.parseResult as Record<string, unknown>).parsed &&
            typeof (payload.parseResult as Record<string, unknown>).parsed === "object") ||
            ((payload.parseResult as Record<string, unknown>).status === "error" &&
              typeof (payload.parseResult as Record<string, unknown>).error === "string"))
            ? (payload.parseResult as ThoughtActionEntry["parseResult"])
            : undefined;
        return {
          type: "thought-action",
          id: row.id,
          conversationIndex: row.conversation_index,
          createdAt: row.created_at,
          parentId: row.parent_id,
          status,
          ...(summary ? { summary } : {}),
          ...(action ? { action } : {}),
          ...(toolName ? { toolName } : {}),
          ...(error ? { error } : {}),
          ...(parseResult ? { parseResult } : {}),
        } satisfies ThoughtActionEntry;
      }
      if (row.type === "title_llm_stream") {
        const llmModel =
          typeof payload.llmModel === "string" && payload.llmModel.trim() !== "" ? payload.llmModel.trim() : undefined;
        const promptTokens =
          typeof payload.promptTokens === "number" && Number.isFinite(payload.promptTokens)
            ? payload.promptTokens
            : undefined;
        const cachedPromptTokens =
          typeof payload.cachedPromptTokens === "number" && Number.isFinite(payload.cachedPromptTokens)
            ? payload.cachedPromptTokens
            : undefined;
        const completionTokens =
          typeof payload.completionTokens === "number" && Number.isFinite(payload.completionTokens)
            ? payload.completionTokens
            : undefined;
        const status =
          payload.status === "running" ||
          payload.status === "completed" ||
          payload.status === "failed" ||
          payload.status === "cancelled"
            ? payload.status
            : payload.failed === true
              ? "failed"
              : Number.isFinite(payload.thoughtMs as number)
                ? "completed"
                : "running";
        const error = typeof payload.error === "string" && payload.error.trim() !== "" ? payload.error : undefined;
        return {
          type: "title_llm_stream",
          id: row.id,
          conversationIndex: row.conversation_index,
          createdAt: row.created_at,
          parentId: row.parent_id,
          llmRequest: String(payload.llmRequest ?? ""),
          llmResponse: typeof payload.llmResponse === "string" ? payload.llmResponse : undefined,
          thoughtMs: Number.isFinite(payload.thoughtMs as number) ? (payload.thoughtMs as number) : null,
          decision: payload.decision && typeof payload.decision === "object" ? (payload.decision as LlmDecision) : null,
          status,
          ...(error !== undefined ? { error } : {}),
          ...(llmModel !== undefined ? { llmModel } : {}),
          ...(promptTokens !== undefined ? { promptTokens } : {}),
          ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
          ...(completionTokens !== undefined ? { completionTokens } : {}),
        } satisfies TitleLlmStreamEntry;
      }
      return {
        type: "tool-invocation",
        id: row.id,
        conversationIndex: row.conversation_index,
        createdAt: row.created_at,
        parentId: row.parent_id,
        toolId: String(payload.toolId ?? ""),
        state:
          payload.state === "requested" ||
          payload.state === "running" ||
          payload.state === "done" ||
          payload.state === "error"
            ? payload.state
            : "running",
        parameters:
          payload.parameters && typeof payload.parameters === "object"
            ? (payload.parameters as Record<string, unknown>)
            : {},
        result: payload.result ?? null,
      } satisfies ToolInvocationEntry;
  }
}
