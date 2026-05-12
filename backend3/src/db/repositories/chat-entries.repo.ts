import { Injectable } from '@nestjs/common';
import type { ChatEntry, ToolInvocationEntry } from '../../contracts/chatEntry.js';
import { rowToChatEntry } from './chat-entry.mapper.js';
import { PrismaService } from '../prisma.service.js';
import { rowToChatMessage, type ChatEntryDbRow } from './chat-entries.payload.js';
import type {
  AssistantMessageEntryRow,
  ChatMessageEntryRow,
  ThoughtStepStatus,
  UserMessageEntryRow,
} from './chat-entries.types.js';

export type ToolInvocationState = ToolInvocationEntry['state'];

export type {
  AssistantMessageEntryRow,
  ChatMessageEntryRow,
  ThoughtStepStatus,
  UserMessageEntryRow,
} from './chat-entries.types.js';

type AppendInput = {
  type: string;
  parentId?: string | null;
  payload: Record<string, unknown>;
};

type AppendedRow = {
  id: string;
  conversationIndex: number;
  createdAt: string;
  parentId: string | null;
};

@Injectable()
export class ChatEntriesRepo {
  /**
   * Per-conversation append lock. Serializes leaf reads / inserts / leaf writes
   * across concurrent thoughts so the resulting chain stays linear instead of
   * branching every time two thoughts race on the same active leaf.
   */
  private readonly appendLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly prisma: PrismaService) {}

  private async withAppendLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.appendLocks.get(conversationId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.appendLocks.set(
      conversationId,
      next.finally(() => {
        if (this.appendLocks.get(conversationId) === next) {
          this.appendLocks.delete(conversationId);
        }
      }),
    );
    return next;
  }

  async getActiveLeafEntryId(conversationId: string): Promise<string | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT active_leaf_entry_id AS id
       FROM conversations
       WHERE id = ?`,
      conversationId,
    )) as Array<{ id: string | null }>;
    return rows[0]?.id ?? null;
  }

  private async setActiveLeafEntryId(conversationId: string, entryId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE conversations SET active_leaf_entry_id = ? WHERE id = ?`,
      entryId,
      conversationId,
    );
  }

  private async appendEntry(conversationId: string, input: AppendInput): Promise<AppendedRow> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const explicitParentProvided = input.parentId !== undefined;
    const explicitParent = input.parentId ?? null;
    const payloadJson = JSON.stringify(input.payload);
    return this.withAppendLock(conversationId, () =>
      this.prisma.$transaction(async (tx) => {
        const idxRows = (await tx.$queryRawUnsafe(
          `SELECT COALESCE(MAX(conversation_index), -1) + 1 AS idx
           FROM chat_entries
           WHERE conversation_id = ?`,
          conversationId,
        )) as Array<{ idx: number }>;
        const conversationIndex = Number(idxRows[0]?.idx ?? 0);

        let parentId: string | null;
        if (explicitParentProvided) {
          parentId = explicitParent;
        } else {
          const leafRows = (await tx.$queryRawUnsafe(
            `SELECT active_leaf_entry_id AS id FROM conversations WHERE id = ?`,
            conversationId,
          )) as Array<{ id: string | null }>;
          parentId = leafRows[0]?.id ?? null;
        }

        await tx.$executeRawUnsafe(
          `INSERT INTO chat_entries (
             id, conversation_id, conversation_index, parent_id, type, payload_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          id,
          conversationId,
          conversationIndex,
          parentId,
          input.type,
          payloadJson,
          createdAt,
        );
        await tx.$executeRawUnsafe(
          `UPDATE conversations
           SET active_leaf_entry_id = ?, last_message_at = ?, updated_at = ?
           WHERE id = ?`,
          id,
          createdAt,
          createdAt,
          conversationId,
        );
        return { id, conversationIndex, createdAt, parentId };
      }),
    );
  }

  async appendUserMessage(
    conversationId: string,
    input: {
      text: string;
      agentId: string;
      llmProviderId?: string;
      llmModel?: string;
      modelPresetId?: number;
      parentId?: string | null;
    },
  ): Promise<UserMessageEntryRow> {
    const payload: Record<string, unknown> = { text: input.text, agentId: input.agentId };
    if (input.llmProviderId) payload.llmProviderId = input.llmProviderId;
    if (input.llmModel) payload.llmModel = input.llmModel;
    if (input.modelPresetId !== undefined) payload.modelPresetId = input.modelPresetId;
    const row = await this.appendEntry(conversationId, {
      type: 'user-message',
      parentId: input.parentId,
      payload,
    });
    const result: UserMessageEntryRow = {
      type: 'user-message',
      id: row.id,
      conversationIndex: row.conversationIndex,
      createdAt: row.createdAt,
      parentId: row.parentId,
      text: input.text,
      agentId: input.agentId,
    };
    if (input.llmProviderId) result.llmProviderId = input.llmProviderId;
    if (input.llmModel) result.llmModel = input.llmModel;
    if (input.modelPresetId !== undefined) result.modelPresetId = input.modelPresetId;
    return result;
  }

  async appendAssistantMessage(
    conversationId: string,
    input: { text: string },
  ): Promise<AssistantMessageEntryRow> {
    const row = await this.appendEntry(conversationId, {
      type: 'assistant-message',
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
      parentId?: string | null;
      status?: ThoughtStepStatus;
      requestText?: string;
      title?: string;
      llmProviderId?: string;
      llmModel?: string;
    },
  ): Promise<{ id: string }> {
    const payload: Record<string, unknown> = {
      thoughtId: input.thoughtId,
      requestText: input.requestText ?? '',
      status: input.status ?? 'running',
    };
    if (input.title) payload.title = input.title;
    if (input.llmProviderId) payload.llmProviderId = input.llmProviderId;
    if (input.llmModel) payload.llmModel = input.llmModel;
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
      type: 'planner_llm_stream' | 'title_llm_stream';
      thoughtId: string;
      parentId?: string | null;
      status?: ThoughtStepStatus;
      llmProviderId?: string;
      llmModel?: string;
    },
  ): Promise<{ id: string }> {
    const payload: Record<string, unknown> = {
      thoughtId: input.thoughtId,
      llmRequest: '',
      llmResponse: '',
      thoughtMs: null,
      decision: null,
      status: input.status ?? 'running',
    };
    if (input.llmProviderId) payload.llmProviderId = input.llmProviderId;
    if (input.llmModel) payload.llmModel = input.llmModel;
    const row = await this.appendEntry(conversationId, {
      type: input.type,
      parentId: input.parentId,
      payload,
    });
    return { id: row.id };
  }

  async appendThoughtActionEntry(
    conversationId: string,
    input: {
      thoughtId: string;
      parentId?: string | null;
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

  async setActiveLeafEntry(conversationId: string, entryId: string): Promise<void> {
    const trimmed = entryId.trim();
    if (!trimmed) throw new Error('entryId is required');
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT 1 AS present FROM chat_entries WHERE conversation_id = ? AND id = ? LIMIT 1`,
      conversationId,
      trimmed,
    )) as Array<{ present: number }>;
    if (rows.length === 0) {
      throw new Error(`entry not found in conversation: ${trimmed}`);
    }
    await this.setActiveLeafEntryId(conversationId, trimmed);
  }

  async listMessages(conversationId: string): Promise<ChatMessageEntryRow[]> {
    const leafId = await this.getActiveLeafEntryId(conversationId);
    const rows = leafId ? await this.fetchLineageRows(conversationId, leafId) : [];
    if (rows.length === 0) return [];
    return rows.flatMap((row) => {
      const message = rowToChatMessage(row);
      return message ? [message] : [];
    });
  }

  async listChatEntries(conversationId: string, opts: { all?: boolean } = {}): Promise<ChatEntry[]> {
    if (opts.all) {
      const rows = await this.fetchAllRows(conversationId);
      return rows.map(rowToChatEntry);
    }
    const leafId = await this.getActiveLeafEntryId(conversationId);
    if (!leafId) return [];
    const rows = await this.fetchLineageRows(conversationId, leafId);
    return rows.map(rowToChatEntry);
  }

  private async fetchAllRows(conversationId: string): Promise<ChatEntryDbRow[]> {
    return (await this.prisma.$queryRawUnsafe(
      `SELECT id, conversation_id, conversation_index, parent_id, type, payload_json, created_at
       FROM chat_entries
       WHERE conversation_id = ?
       ORDER BY conversation_index ASC`,
      conversationId,
    )) as ChatEntryDbRow[];
  }

  private async fetchLineageRows(conversationId: string, leafEntryId: string): Promise<ChatEntryDbRow[]> {
    return (await this.prisma.$queryRawUnsafe(
      `WITH RECURSIVE lineage(id, parent_id) AS (
         SELECT id, parent_id FROM chat_entries
         WHERE conversation_id = ? AND id = ?
         UNION ALL
         SELECT e.id, e.parent_id FROM chat_entries e
         JOIN lineage l ON l.parent_id = e.id
         WHERE e.conversation_id = ?
       )
       SELECT e.id, e.conversation_id, e.conversation_index, e.parent_id, e.type, e.payload_json, e.created_at
       FROM chat_entries e
       JOIN lineage l ON l.id = e.id
       WHERE e.conversation_id = ?
       ORDER BY e.conversation_index ASC`,
      conversationId,
      leafEntryId,
      conversationId,
      conversationId,
    )) as ChatEntryDbRow[];
  }

  async isEntryOnActiveLineage(conversationId: string, entryId: string): Promise<boolean> {
    const leafId = await this.getActiveLeafEntryId(conversationId);
    if (!leafId) return false;
    const rows = (await this.prisma.$queryRawUnsafe(
      `WITH RECURSIVE lineage(id, parent_id) AS (
         SELECT id, parent_id FROM chat_entries
         WHERE conversation_id = ? AND id = ?
         UNION ALL
         SELECT e.id, e.parent_id FROM chat_entries e
         JOIN lineage l ON l.parent_id = e.id
         WHERE e.conversation_id = ?
       )
       SELECT 1 AS present FROM lineage WHERE id = ? LIMIT 1`,
      conversationId,
      leafId,
      conversationId,
      entryId,
    )) as Array<{ present: number }>;
    return rows.length > 0;
  }

  async getMessage(conversationId: string, entryId: string): Promise<ChatMessageEntryRow | null> {
    const row = await this.fetchEntryRow(conversationId, entryId);
    return row ? rowToChatMessage(row) : null;
  }

  async getChatEntry(conversationId: string, entryId: string): Promise<ChatEntry | null> {
    const row = await this.fetchEntryRow(conversationId, entryId);
    return row ? rowToChatEntry(row) : null;
  }

  private async fetchEntryRow(conversationId: string, entryId: string): Promise<ChatEntryDbRow | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, conversation_id, conversation_index, parent_id, type, payload_json, created_at
       FROM chat_entries
       WHERE conversation_id = ? AND id = ?
       LIMIT 1`,
      conversationId,
      entryId,
    )) as ChatEntryDbRow[];
    return rows[0] ?? null;
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
    await this.prisma.$executeRawUnsafe(
      `UPDATE chat_entries SET payload_json = ? WHERE conversation_id = ? AND id = ? AND type = 'thought-action'`,
      JSON.stringify(payload),
      conversationId,
      entryId,
    );
  }

  async setEntryStatus(conversationId: string, entryId: string, status: ThoughtStepStatus): Promise<void> {
    await this.mergeEntryPayload(conversationId, entryId, { status });
  }

  async mergeEntryPayload(
    conversationId: string,
    entryId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const row = await this.fetchEntryRow(conversationId, entryId);
    if (!row) throw new Error(`chat entry not found: ${entryId}`);
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    Object.assign(payload, patch);
    await this.prisma.$executeRawUnsafe(
      `UPDATE chat_entries SET payload_json = ? WHERE conversation_id = ? AND id = ?`,
      JSON.stringify(payload),
      conversationId,
      entryId,
    );
  }

  async appendToolInvocation(
    conversationId: string,
    input: {
      toolId: string;
      state: ToolInvocationState;
      parameters: Record<string, unknown>;
      result?: unknown;
      parentId?: string | null;
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
    if (input.parameters !== undefined) patch.parameters = input.parameters;
    await this.mergeEntryPayload(conversationId, input.id, patch);
  }

  async findPendingToolInvocation(
    conversationId: string,
    toolId: string,
    toolRequest?: string,
  ): Promise<ToolInvocationEntry | null> {
    const entries = await this.listChatEntries(conversationId);
    const pending = entries.filter(
      (e): e is ToolInvocationEntry =>
        e.type === 'tool-invocation' && e.toolId === toolId && (e.state === 'requested' || e.state === 'running'),
    );
    if (pending.length === 0) return null;
    if (toolRequest) {
      const match = pending.findLast((e) => String(e.parameters.tool_request ?? '').trim() === toolRequest);
      if (match) return match;
    }
    return pending.at(-1) ?? null;
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
    await this.prisma.$executeRawUnsafe(
      `UPDATE chat_entries
       SET payload_json = ?
       WHERE conversation_id = ? AND id = ? AND type = 'assistant-message'`,
      JSON.stringify({ text: input.text }),
      conversationId,
      input.id,
    );
  }
}
