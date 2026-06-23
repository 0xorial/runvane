import type { ChatAttachment, ChatEntry, ToolInvocationEntry } from '../../contracts/chatEntry.js';
import type { ThoughtStreamEntryType } from '../../thoughtProcessing/types.js';
import { rowToChatEntry } from './chat-entry.mapper.js';
import { PrismaService } from '../prisma.service.js';
import { StreamCursorService } from '../stream-cursor.service.js';
import type { ChatEntryDbRow, ChatMessageEntry, ThoughtStepStatus } from './chat-entries.types.js';

type AppendInput = {
  type: string;
  parentId: string | null;
  payload: Record<string, unknown>;
};

type AppendedRow = {
  id: string;
  conversationIndex: number;
  createdAt: string;
  parentId: string | null;
  /** Stream cursor value bumped by this mutation's txn — the event's seq. */
  seq: number;
};

/** Bump the global stream cursor inside `tx` and return its new value (the seq). */
async function bumpCursor(tx: { $queryRawUnsafe: (sql: string) => Promise<unknown> }): Promise<number> {
  const rows = (await tx.$queryRawUnsafe(
    `UPDATE stream_cursor SET value = value + 1 WHERE id = 0 RETURNING value`,
  )) as Array<{ value: number }>;
  return Number(rows[0]?.value ?? 0);
}

/** Minimal txn surface for an entry-mutating statement run via `mutateEntry`. */
type EntryWriteTx = { $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown> };

export class ChatEntriesBaseRepo {
  /**
   * Per-conversation append lock. Serializes leaf reads / inserts / leaf writes
   * across concurrent thoughts so the resulting chain stays linear instead of
   * branching every time two thoughts race on the same active leaf.
   */
  private readonly appendLocks = new Map<string, Promise<unknown>>();

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly cursor: StreamCursorService,
  ) {}

  protected async withAppendLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
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

  protected async appendEntry(conversationId: string, input: AppendInput): Promise<AppendedRow> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const parentId = input.parentId;
    const payloadJson = JSON.stringify(input.payload);
    const result = await this.withAppendLock(conversationId, () =>
      this.prisma.$transaction(async (tx) => {
        const idxRows = (await tx.$queryRawUnsafe(
          `SELECT COALESCE(MAX(conversation_index), -1) + 1 AS idx
           FROM chat_entries
           WHERE conversation_id = ?`,
          conversationId,
        )) as Array<{ idx: number }>;
        const conversationIndex = Number(idxRows[0]?.idx ?? 0);

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
           SET last_message_at = ?, updated_at = ?
           WHERE id = ?`,
          createdAt,
          createdAt,
          conversationId,
        );
        // Bump the cursor in the SAME txn: its value is this mutation's seq and
        // the snapshot watermark — born from the commit, so publish (which
        // carries it) can't precede the write.
        const seq = await bumpCursor(tx);
        return { id, conversationIndex, createdAt, parentId, seq };
      }),
    );
    this.cursor.note(result.seq);
    return result;
  }

  /**
   * Resolve the user's default-view branch to its current leaf.
   *
   * `default_view_leaf_entry_id` stores only the user's last-selected anchor
   * — appended descendants don't update it. To render a branch we walk down
   * children from the anchor, picking the latest descendant at each step
   * (ties broken by `conversation_index DESC`). Reload after a run yields
   * the same branch tip as the live SSE stream produced.
   */
  async resolveDefaultViewLeaf(conversationId: string): Promise<string | null> {
    const anchorRows = (await this.prisma.$queryRawUnsafe(
      `SELECT default_view_leaf_entry_id AS id
       FROM conversations
       WHERE id = ?`,
      conversationId,
    )) as Array<{ id: string | null }>;
    const anchor = anchorRows[0]?.id ?? null;
    if (!anchor) return this.resolveDeepestLeaf(conversationId);
    return this.walkToLatestLeaf(conversationId, anchor);
  }

  private async walkToLatestLeaf(conversationId: string, anchorId: string): Promise<string> {
    let cursor = anchorId;
    const visited = new Set<string>([cursor]);
    for (;;) {
      const childRows = (await this.prisma.$queryRawUnsafe(
        `SELECT id FROM chat_entries
         WHERE conversation_id = ? AND parent_id = ?
         ORDER BY conversation_index DESC
         LIMIT 1`,
        conversationId,
        cursor,
      )) as Array<{ id: string }>;
      const next = childRows[0]?.id;
      if (!next || visited.has(next)) return cursor;
      visited.add(next);
      cursor = next;
    }
  }

  private async resolveDeepestLeaf(conversationId: string): Promise<string | null> {
    const roots = (await this.prisma.$queryRawUnsafe(
      `SELECT id FROM chat_entries
       WHERE conversation_id = ? AND parent_id IS NULL
       ORDER BY conversation_index ASC
       LIMIT 1`,
      conversationId,
    )) as Array<{ id: string }>;
    if (!roots[0]) return null;
    return this.walkToLatestLeaf(conversationId, roots[0].id);
  }

  async listMessages(conversationId: string): Promise<ChatMessageEntry[]> {
    const leafId = await this.resolveDefaultViewLeaf(conversationId);
    return leafId ? this.listMessagesFromLeaf(conversationId, leafId) : [];
  }

  async listMessagesFromLeaf(conversationId: string, leafEntryId: string): Promise<ChatMessageEntry[]> {
    const rows = await this.fetchLineageRows(conversationId, leafEntryId);
    return rows
      .map(rowToChatEntry)
      .filter((e): e is ChatMessageEntry => e.type === 'user-message' || e.type === 'assistant-message');
  }

  async listChatEntries(conversationId: string, opts: { all?: boolean } = {}): Promise<ChatEntry[]> {
    if (opts.all) {
      const rows = await this.fetchAllRows(conversationId);
      return rows.map(rowToChatEntry);
    }
    const leafId = await this.resolveDefaultViewLeaf(conversationId);
    if (!leafId) return [];
    return this.listChatEntriesFromLeaf(conversationId, leafId);
  }

  async listChatEntriesFromLeaf(conversationId: string, leafEntryId: string): Promise<ChatEntry[]> {
    const rows = await this.fetchLineageRows(conversationId, leafEntryId);
    return rows.map(rowToChatEntry);
  }

  /**
   * Consistent snapshot for the per-conversation stream: all entries + the
   * cursor watermark read in ONE txn, so W exactly matches the entries (no
   * write can interleave the two reads). This is the stream's first frame.
   */
  async snapshot(conversationId: string): Promise<{ entries: ChatEntry[]; seq: number }> {
    return this.prisma.$transaction(async (tx) => {
      const curRows = (await tx.$queryRawUnsafe(
        `SELECT value FROM stream_cursor WHERE id = 0`,
      )) as Array<{ value: number }>;
      const seq = Number(curRows[0]?.value ?? 0);
      const rows = (await tx.$queryRawUnsafe(
        `SELECT id, conversation_id, conversation_index, parent_id, type, payload_json, created_at
         FROM chat_entries
         WHERE conversation_id = ?
         ORDER BY conversation_index ASC`,
        conversationId,
      )) as ChatEntryDbRow[];
      return { entries: rows.map(rowToChatEntry), seq };
    });
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

  async getChatEntry(conversationId: string, entryId: string): Promise<ChatEntry | null> {
    const row = await this.fetchEntryRow(conversationId, entryId);
    return row ? rowToChatEntry(row) : null;
  }

  protected async fetchEntryRow(conversationId: string, entryId: string): Promise<ChatEntryDbRow | null> {
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

  /**
   * Set the user's default-view leaf hint. Only the user's view drives this:
   * the message-post path (so reload shows the just-sent message), the
   * planner finalizing an answer (so reload shows the assistant message), or
   * the explicit branch-switch endpoint. Running thoughts MUST NOT touch it.
   */
  async setDefaultViewLeaf(conversationId: string, entryId: string): Promise<void> {
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
    await this.prisma.$executeRawUnsafe(
      `UPDATE conversations SET default_view_leaf_entry_id = ? WHERE id = ?`,
      trimmed,
      conversationId,
    );
  }

  /**
   * Run an entry-mutating statement inside a txn that ALSO bumps the stream
   * cursor, then advance the in-memory mirror. Every published change to a
   * chat entry must go through here (or `appendEntry`): the cursor value is the
   * event's seq AND the snapshot watermark, so a mutation that skips the bump
   * rides a stale seq and the client's `seq > W` gate silently drops it. A
   * snapshot read in the window between a spliced step's append and the
   * reparent of its successor would otherwise capture the transient fork and
   * never receive the reparent — freezing it into a spurious sibling branch.
   */
  protected async mutateEntry(fn: (tx: EntryWriteTx) => Promise<unknown>): Promise<number> {
    const seq = await this.prisma.$transaction(async (tx) => {
      await fn(tx);
      return bumpCursor(tx);
    });
    this.cursor.note(seq);
    return seq;
  }

  async mergeEntryPayload(
    conversationId: string,
    entryId: string,
    patch: Record<string, unknown>,
  ): Promise<number> {
    const row = await this.fetchEntryRow(conversationId, entryId);
    if (!row) throw new Error(`chat entry not found: ${entryId}`);
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    Object.assign(payload, patch);
    return this.mutateEntry((tx) =>
      tx.$executeRawUnsafe(
        `UPDATE chat_entries SET payload_json = ? WHERE conversation_id = ? AND id = ?`,
        JSON.stringify(payload),
        conversationId,
        entryId,
      ),
    );
  }

  async setEntryStatus(conversationId: string, entryId: string, status: ThoughtStepStatus): Promise<void> {
    await this.mergeEntryPayload(conversationId, entryId, { status });
  }

  /**
   * Rewrite an entry's parent pointer. Used by ChatChain to keep all steps of a
   * single thought contiguous: when a thought's later step lands while another
   * thought has already appended after it, we splice the new step in by
   * reparenting the intervening entry onto the new one.
   */
  async updateChatEntryParent(conversationId: string, entryId: string, newParentId: string | null): Promise<void> {
    await this.mutateEntry((tx) =>
      tx.$executeRawUnsafe(
        `UPDATE chat_entries SET parent_id = ? WHERE conversation_id = ? AND id = ?`,
        newParentId,
        conversationId,
        entryId,
      ),
    );
  }
}
