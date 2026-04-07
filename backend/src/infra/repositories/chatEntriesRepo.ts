import type {
  ChatAttachment,
  ChatEntry,
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
  type: string;
  payload_json: string;
  created_at: string;
};

export class ChatEntriesRepo {
  constructor(private readonly db: SqliteDb) {}

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

  appendUserMessage(
    conversationId: string,
    text: string,
    opts?: UserMessageSelection & { attachments?: ChatAttachment[] },
  ): UserMessageEntry {
    const createDbEntryPayload = normalizeUserMessageSelection(opts);
    const attachments = Array.isArray(opts?.attachments) ? opts.attachments : [];
    const createdAt = new Date().toISOString();
    const entry: UserMessageEntry = {
      type: "user-message",
      id: crypto.randomUUID(),
      conversationIndex: this.nextConversationIndex(conversationId),
      createdAt,
      text,
      ...createDbEntryPayload,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
    this.db
      .prepare(
        `INSERT INTO chat_entries (
           id, conversation_id, conversation_index, type, payload_json, created_at
         ) VALUES (
           @id, @conversation_id, @conversation_index, @type, @payload_json, @created_at
         )`,
      )
      .run({
        id: entry.id,
        conversation_id: conversationId,
        conversation_index: entry.conversationIndex,
        type: entry.type,
        payload_json: JSON.stringify({
          text: entry.text,
          ...createDbEntryPayload,
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
        created_at: entry.createdAt,
      });
    return entry;
  }

  appendAssistantMessage(
    conversationId: string,
    text: string,
    opts?: { id?: string; createdAt?: string },
  ): AssistantMessageEntry {
    const createdAt = opts?.createdAt ?? new Date().toISOString();
    const entry: AssistantMessageEntry = {
      type: "assistant-message",
      id: opts?.id ?? crypto.randomUUID(),
      conversationIndex: this.nextConversationIndex(conversationId),
      createdAt,
      text,
    };
    this.db
      .prepare(
        `INSERT INTO chat_entries (
           id, conversation_id, conversation_index, type, payload_json, created_at
         ) VALUES (
           @id, @conversation_id, @conversation_index, @type, @payload_json, @created_at
         )`,
      )
      .run({
        id: entry.id,
        conversation_id: conversationId,
        conversation_index: entry.conversationIndex,
        type: entry.type,
        payload_json: JSON.stringify({ text: entry.text }),
        created_at: entry.createdAt,
      });
    return entry;
  }

  updateAssistantMessage(
    conversationId: string,
    input: { id: string; text: string },
  ): void {
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
      throw new Error(
        `assistant-message entry not found for update: conversation=${conversationId} id=${input.id}`,
      );
    }
  }

  appendToolInvocation(
    conversationId: string,
    input: {
      id?: string;
      createdAt?: string;
      toolId: string;
      state: ToolInvocationEntry["state"];
      parameters?: Record<string, unknown>;
      result?: unknown;
    },
  ): ToolInvocationEntry {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const entry: ToolInvocationEntry = {
      type: "tool-invocation",
      id: input.id ?? crypto.randomUUID(),
      conversationIndex: this.nextConversationIndex(conversationId),
      createdAt,
      toolId: input.toolId,
      state: input.state,
      parameters: input.parameters ?? {},
      result: input.result ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO chat_entries (
           id, conversation_id, conversation_index, type, payload_json, created_at
         ) VALUES (
           @id, @conversation_id, @conversation_index, @type, @payload_json, @created_at
         )`,
      )
      .run({
        id: entry.id,
        conversation_id: conversationId,
        conversation_index: entry.conversationIndex,
        type: entry.type,
        payload_json: JSON.stringify({
          toolId: entry.toolId,
          state: entry.state,
          parameters: entry.parameters,
          result: entry.result,
        }),
        created_at: entry.createdAt,
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
      throw new Error(
        `tool-invocation entry not found for update: conversation=${conversationId} id=${input.id}`,
      );
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
          parameters:
            payload.parameters && typeof payload.parameters === "object"
              ? payload.parameters
              : {},
          result: input.result,
        }),
      });
  }

  appendPlannerLlmStreamEntry(
    conversationId: string,
    input: {
      id: string;
      createdAt: string;
      llmRequest: string;
      llmResponse?: string;
      thoughtMs?: number | null;
      decision?: LlmDecision | null;
      failed?: boolean;
      llmModel?: string;
    },
  ): PlannerLlmStreamEntry {
    const conversationIndex = this.nextConversationIndex(conversationId);
    const llmModelRaw = typeof input.llmModel === "string" ? input.llmModel.trim() : "";
    const llmModel = llmModelRaw.length > 0 ? llmModelRaw : undefined;
    const entry: PlannerLlmStreamEntry = {
      type: "planner_llm_stream",
      id: input.id,
      conversationIndex,
      createdAt: input.createdAt,
      llmRequest: input.llmRequest,
      llmResponse: input.llmResponse ?? "",
      thoughtMs: input.thoughtMs ?? null,
      decision: input.decision ?? null,
      failed: input.failed === true,
      ...(llmModel !== undefined ? { llmModel } : {}),
    };
    const payload: Record<string, unknown> = {
      llmRequest: entry.llmRequest,
      llmResponse: entry.llmResponse ?? "",
      thoughtMs: entry.thoughtMs ?? null,
      decision: entry.decision ?? null,
      failed: entry.failed === true,
    };
    if (llmModel !== undefined) payload.llmModel = llmModel;
    this.db
      .prepare(
        `INSERT INTO chat_entries (
           id, conversation_id, conversation_index, type, payload_json, created_at
         ) VALUES (
           @id, @conversation_id, @conversation_index, 'planner_llm_stream', @payload_json, @created_at
         )`,
      )
      .run({
        id: entry.id,
        conversation_id: conversationId,
        conversation_index: entry.conversationIndex,
        payload_json: JSON.stringify(payload),
        created_at: entry.createdAt,
      });
    return entry;
  }

  appendTitleLlmStreamEntry(
    conversationId: string,
    input: {
      id: string;
      createdAt: string;
      llmRequest: string;
      llmResponse?: string;
      thoughtMs?: number | null;
      decision?: LlmDecision | null;
      failed?: boolean;
      llmModel?: string;
    },
  ): TitleLlmStreamEntry {
    const conversationIndex = this.nextConversationIndex(conversationId);
    const llmModelRaw = typeof input.llmModel === "string" ? input.llmModel.trim() : "";
    const llmModel = llmModelRaw.length > 0 ? llmModelRaw : undefined;
    const entry: TitleLlmStreamEntry = {
      type: "title_llm_stream",
      id: input.id,
      conversationIndex,
      createdAt: input.createdAt,
      llmRequest: input.llmRequest,
      llmResponse: input.llmResponse ?? "",
      thoughtMs: input.thoughtMs ?? null,
      decision: input.decision ?? null,
      failed: input.failed === true,
      ...(llmModel !== undefined ? { llmModel } : {}),
    };
    const payload: Record<string, unknown> = {
      llmRequest: entry.llmRequest,
      llmResponse: entry.llmResponse ?? "",
      thoughtMs: entry.thoughtMs ?? null,
      decision: entry.decision ?? null,
      failed: entry.failed === true,
    };
    if (llmModel !== undefined) payload.llmModel = llmModel;
    this.db
      .prepare(
        `INSERT INTO chat_entries (
           id, conversation_id, conversation_index, type, payload_json, created_at
         ) VALUES (
           @id, @conversation_id, @conversation_index, 'title_llm_stream', @payload_json, @created_at
         )`,
      )
      .run({
        id: entry.id,
        conversation_id: conversationId,
        conversation_index: entry.conversationIndex,
        payload_json: JSON.stringify(payload),
        created_at: entry.createdAt,
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
      failed?: boolean;
      llmModel?: string;
      promptTokens?: number;
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
      failed: input.failed === true,
    };
    if (llmModel !== undefined) payload.llmModel = llmModel;
    if (typeof input.promptTokens === "number" && Number.isFinite(input.promptTokens)) {
      payload.promptTokens = input.promptTokens;
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
           AND type = 'planner_llm_stream'`,
      )
      .run({
        id: input.id,
        conversation_id: conversationId,
        payload_json: JSON.stringify(payload),
      });
    if (Number(result.changes ?? 0) !== 1) {
      throw new Error(
        `planner_llm_stream entry not found for update: conversation=${conversationId} id=${input.id}`,
      );
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
      failed?: boolean;
      llmModel?: string;
      promptTokens?: number;
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
      failed: input.failed === true,
    };
    if (llmModel !== undefined) payload.llmModel = llmModel;
    if (typeof input.promptTokens === "number" && Number.isFinite(input.promptTokens)) {
      payload.promptTokens = input.promptTokens;
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
      throw new Error(
        `title_llm_stream entry not found for update: conversation=${conversationId} id=${input.id}`,
      );
    }
  }

  getLastUserMessage(conversationId: string): UserMessageEntry | null {
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, conversation_index, type, payload_json, created_at
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
      text: String(payload.text ?? ""),
      ...selection,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }

  listMessages(conversationId: string): ChatEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, conversation_index, type, payload_json, created_at
         FROM chat_entries
         WHERE conversation_id = ?
         ORDER BY conversation_index ASC`,
      )
      .all(conversationId) as ChatEntryDbRow[];

    return rows.map((row) => {
      const payload = parseJsonObject(row.payload_json);
      if (row.type === "user-message") {
        const selection = userMessageSelectionFromPayload(payload);
        const attachments = userMessageAttachmentsFromPayload(payload);
        return {
          type: "user-message",
          id: row.id,
          conversationIndex: row.conversation_index,
          createdAt: row.created_at,
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
          text: String(payload.text ?? ""),
        } satisfies AssistantMessageEntry;
      }
      if (row.type === "planner_llm_stream") {
        const llmModel =
          typeof payload.llmModel === "string" && payload.llmModel.trim() !== ""
            ? payload.llmModel.trim()
            : undefined;
        const promptTokens =
          typeof payload.promptTokens === "number" && Number.isFinite(payload.promptTokens)
            ? payload.promptTokens
            : undefined;
        const completionTokens =
          typeof payload.completionTokens === "number" &&
          Number.isFinite(payload.completionTokens)
            ? payload.completionTokens
            : undefined;
        return {
          type: "planner_llm_stream",
          id: row.id,
          conversationIndex: row.conversation_index,
          createdAt: row.created_at,
          llmRequest: String(payload.llmRequest ?? ""),
          llmResponse:
            typeof payload.llmResponse === "string" ? payload.llmResponse : undefined,
          thoughtMs: Number.isFinite(payload.thoughtMs as number)
            ? (payload.thoughtMs as number)
            : null,
          decision:
            payload.decision && typeof payload.decision === "object"
              ? (payload.decision as LlmDecision)
              : null,
          failed: payload.failed === true,
          ...(llmModel !== undefined ? { llmModel } : {}),
          ...(promptTokens !== undefined ? { promptTokens } : {}),
          ...(completionTokens !== undefined ? { completionTokens } : {}),
        } satisfies PlannerLlmStreamEntry;
      }
      if (row.type === "title_llm_stream") {
        const llmModel =
          typeof payload.llmModel === "string" && payload.llmModel.trim() !== ""
            ? payload.llmModel.trim()
            : undefined;
        const promptTokens =
          typeof payload.promptTokens === "number" && Number.isFinite(payload.promptTokens)
            ? payload.promptTokens
            : undefined;
        const completionTokens =
          typeof payload.completionTokens === "number" &&
          Number.isFinite(payload.completionTokens)
            ? payload.completionTokens
            : undefined;
        return {
          type: "title_llm_stream",
          id: row.id,
          conversationIndex: row.conversation_index,
          createdAt: row.created_at,
          llmRequest: String(payload.llmRequest ?? ""),
          llmResponse:
            typeof payload.llmResponse === "string" ? payload.llmResponse : undefined,
          thoughtMs: Number.isFinite(payload.thoughtMs as number)
            ? (payload.thoughtMs as number)
            : null,
          decision:
            payload.decision && typeof payload.decision === "object"
              ? (payload.decision as LlmDecision)
              : null,
          failed: payload.failed === true,
          ...(llmModel !== undefined ? { llmModel } : {}),
          ...(promptTokens !== undefined ? { promptTokens } : {}),
          ...(completionTokens !== undefined ? { completionTokens } : {}),
        } satisfies TitleLlmStreamEntry;
      }
      return {
        type: "tool-invocation",
        id: row.id,
        conversationIndex: row.conversation_index,
        createdAt: row.created_at,
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
    });
  }
}
