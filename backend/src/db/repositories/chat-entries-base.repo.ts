import type { ChatAttachment, ChatEntry, ToolInvocationEntry } from '../../contracts/chatEntry.js';
import { ChatEntrySchema } from '../../contracts/chatEntry.js';
import { rowToChatEntry } from './chat-entry.mapper.js';
import { PrismaService } from '../prisma.service.js';
import { StreamCursorService } from '../stream-cursor.service.js';
import type { ChatEntryDbRow, ChatMessageEntry, ThoughtStepStatus } from './chat-entries.types.js';

type AppendInput = {
  type: string;
  parentId: string | null;
  /** Side-lane entry: displayed under its anchor but excluded from branch semantics. */
  isSide?: boolean;
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

const BUMP_CURSOR_SQL = `UPDATE stream_cursor SET value = value + 1 WHERE id = 0 RETURNING value`;

/**
 * All writes here use Prisma's BATCH transaction (`$transaction([...])`), never
 * the interactive callback form. A batch runs synchronously through the
 * better-sqlite3 adapter as one BEGIN/COMMIT — atomic, held only for the
 * statements' own duration, and physically unable to stay open across an
 * `await`. That last property is the point: SQLite has no row locks, so an
 * open write transaction holds the database-wide writer lock, and one held
 * across an await stalls every write in the app (and, on the Prisma 6 Rust
 * engine, could deadlock the engine outright — hit here 2026-06, fixed by
 * removing interactive transactions; that engine is gone since Prisma 7).
 * Transactions provide atomicity here, not mutual exclusion: two concurrent
 * read-decide-write sequences both commit cleanly and still fork the tree,
 * which is why serialization comes from the per-conversation append lock
 * below. PrismaService additionally enforces TX_MAX_OPEN_MS (rollback + throw
 * at the deadline) should the interactive form ever sneak back in.
 */
type SqlStatement = { sql: string; args: readonly unknown[] };

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

  /**
   * Tripwire: refuse to commit a row the snapshot read path can't serve back.
   * Runs the would-be row through `rowToChatEntry` and the `ChatEntrySchema`
   * contract — the same two validators every snapshot/response passes through
   * — so a typed-but-incomplete payload fails the write with the cause
   * attached, instead of surfacing later as a dead /stream when a snapshot
   * happens to read the row (the attachment-summary flake class of bug).
   */
  protected assertServableRow(row: ChatEntryDbRow): void {
    try {
      ChatEntrySchema.parse(rowToChatEntry(row));
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `chat-entry write rejected (type '${row.type}', id ${row.id}): row would break snapshot reads — ${cause}`,
      );
    }
  }

  protected async appendEntry(conversationId: string, input: AppendInput): Promise<AppendedRow> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const parentId = input.parentId;
    const payloadJson = JSON.stringify(input.payload);
    this.assertServableRow({
      id,
      conversation_id: conversationId,
      // The real index is computed inside the INSERT; any number maps fine.
      conversation_index: 0,
      parent_id: parentId,
      is_side: input.isSide ? 1 : 0,
      type: input.type,
      payload_json: payloadJson,
      created_at: new Date(createdAt),
    });
    // One atomic batch: the index is computed by a scalar subquery inside the
    // INSERT itself, and the cursor bump rides the same txn — its value is this
    // mutation's seq and the snapshot watermark, born from the commit, so
    // publish (which carries it) can't precede the write.
    const [insertedRows, , cursorRows] = await this.withAppendLock(conversationId, () =>
      this.prisma.$transaction([
        this.prisma.$queryRawUnsafe(
          `INSERT INTO chat_entries (
             id, conversation_id, conversation_index, parent_id, is_side, type, payload_json, created_at
           ) VALUES (
             ?, ?,
             (SELECT COALESCE(MAX(conversation_index), -1) + 1 FROM chat_entries WHERE conversation_id = ?),
             ?, ?, ?, ?, ?
           ) RETURNING conversation_index`,
          id,
          conversationId,
          conversationId,
          parentId,
          input.isSide ? 1 : 0,
          input.type,
          payloadJson,
          createdAt,
        ),
        this.prisma.$executeRawUnsafe(
          `UPDATE conversations
           SET last_message_at = ?, updated_at = ?
           WHERE id = ?`,
          createdAt,
          createdAt,
          conversationId,
        ),
        this.prisma.$queryRawUnsafe(BUMP_CURSOR_SQL),
      ]),
    );
    const conversationIndex = Number(
      (insertedRows as Array<{ conversation_index: number }>)[0]?.conversation_index ?? 0,
    );
    const seq = Number((cursorRows as Array<{ value: number }>)[0]?.value ?? 0);
    this.cursor.note(seq);
    return { id, conversationIndex, createdAt, parentId, seq };
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
         WHERE conversation_id = ? AND parent_id = ? AND is_side = 0
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
       WHERE conversation_id = ? AND parent_id IS NULL AND is_side = 0
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
    const [curRows, rows] = (await this.prisma.$transaction([
      this.prisma.$queryRawUnsafe(`SELECT value FROM stream_cursor WHERE id = 0`),
      this.prisma.$queryRawUnsafe(
        `SELECT id, conversation_id, conversation_index, parent_id, is_side, type, payload_json, created_at
         FROM chat_entries
         WHERE conversation_id = ?
         ORDER BY conversation_index ASC`,
        conversationId,
      ),
    ])) as [Array<{ value: number }>, ChatEntryDbRow[]];
    const seq = Number(curRows[0]?.value ?? 0);
    return { entries: rows.map(rowToChatEntry), seq };
  }

  private async fetchAllRows(conversationId: string): Promise<ChatEntryDbRow[]> {
    return (await this.prisma.$queryRawUnsafe(
      `SELECT id, conversation_id, conversation_index, parent_id, is_side, type, payload_json, created_at
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
       SELECT e.id, e.conversation_id, e.conversation_index, e.parent_id, e.is_side, e.type, e.payload_json, e.created_at
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

  /**
   * Every side-lane entry of the conversation, in index order. Side entries
   * hang off spine anchors and are excluded from lineage walks; readers that
   * need them (planner input folding attachment summaries in, renderers
   * grouping side thoughts under their anchor) fetch them separately.
   */
  async listSideEntries(conversationId: string): Promise<ChatEntry[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, conversation_id, conversation_index, parent_id, is_side, type, payload_json, created_at
       FROM chat_entries
       WHERE conversation_id = ? AND is_side = 1
       ORDER BY conversation_index ASC`,
      conversationId,
    )) as ChatEntryDbRow[];
    return rows.map(rowToChatEntry);
  }

  protected async fetchEntryRow(conversationId: string, entryId: string): Promise<ChatEntryDbRow | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, conversation_id, conversation_index, parent_id, is_side, type, payload_json, created_at
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
   * rides a stale seq and the client's `seq > W` gate silently drops it.
   */
  protected async mutateEntry(...statements: SqlStatement[]): Promise<number> {
    const results = await this.prisma.$transaction([
      ...statements.map((s) => this.prisma.$executeRawUnsafe(s.sql, ...s.args)),
      this.prisma.$queryRawUnsafe(BUMP_CURSOR_SQL),
    ]);
    const cursorRows = results[results.length - 1] as Array<{ value: number }>;
    const seq = Number(cursorRows[0]?.value ?? 0);
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
    const payloadJson = JSON.stringify(payload);
    this.assertServableRow({ ...row, payload_json: payloadJson });
    return this.mutateEntry({
      sql: `UPDATE chat_entries SET payload_json = ? WHERE conversation_id = ? AND id = ?`,
      args: [payloadJson, conversationId, entryId],
    });
  }

  async setEntryStatus(conversationId: string, entryId: string, status: ThoughtStepStatus): Promise<void> {
    await this.mergeEntryPayload(conversationId, entryId, { status });
  }

  /**
   * Move the subtree rooted at `rootEntryId` out of `sourceConversationId` and
   * into the (empty, pre-created) `targetConversationId`, recording fork
   * provenance on the target. This is the data half of "split from here":
   *
   *  - the root + every descendant (by `parent_id`) are reassigned to the
   *    target and re-indexed 0..n-1 in their original order;
   *  - the root is detached (`parent_id = NULL`) so it becomes a target root;
   *  - the target's fork columns point back at the source and at the entry the
   *    split detached from (the root's former parent, which stays in the
   *    source) so the UI can render a "forked from" link;
   *  - the target's view anchor follows the branch the user was viewing if it
   *    moved, else the new root; the source's anchor is repaired if it pointed
   *    into the moved subtree (so the source no longer resolves to a gone leaf).
   *
   * All in one txn that bumps the stream cursor once, so the SSE watermark
   * advances and a fresh snapshot for either conversation reflects the move.
   */
  async splitOffSubtree(
    sourceConversationId: string,
    rootEntryId: string,
    targetConversationId: string,
  ): Promise<{ rootEntryId: string; forkParentEntryId: string | null; movedCount: number }> {
    const result = await this.withAppendLock(sourceConversationId, async () => {
      // Reads first: the per-conversation append lock serializes them against
      // every other mutation of this conversation, so the plan computed here is
      // still valid when the write batch below runs.
      const rootRows = (await this.prisma.$queryRawUnsafe(
        `SELECT parent_id AS parentId FROM chat_entries WHERE conversation_id = ? AND id = ? LIMIT 1`,
        sourceConversationId,
        rootEntryId,
      )) as Array<{ parentId: string | null }>;
      if (rootRows.length === 0) {
        throw new Error(`entry not found in conversation: ${rootEntryId}`);
      }
      const forkParentEntryId = rootRows[0]?.parentId ?? null;

      const anchorRows = (await this.prisma.$queryRawUnsafe(
        `SELECT default_view_leaf_entry_id AS anchor FROM conversations WHERE id = ?`,
        sourceConversationId,
      )) as Array<{ anchor: string | null }>;
      const sourceAnchor = anchorRows[0]?.anchor ?? null;

      const subtreeRows = (await this.prisma.$queryRawUnsafe(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM chat_entries WHERE conversation_id = ? AND id = ?
           UNION ALL
           SELECT e.id FROM chat_entries e JOIN sub ON e.parent_id = sub.id
           WHERE e.conversation_id = ?
         )
         SELECT e.id FROM chat_entries e JOIN sub ON sub.id = e.id
         WHERE e.conversation_id = ?
         ORDER BY e.conversation_index ASC`,
        sourceConversationId,
        rootEntryId,
        sourceConversationId,
        sourceConversationId,
      )) as Array<{ id: string }>;
      const movedIds = subtreeRows.map((r) => r.id);
      const movedSet = new Set(movedIds);

      const now = new Date().toISOString();
      const targetAnchor = sourceAnchor && movedSet.has(sourceAnchor) ? sourceAnchor : rootEntryId;
      const statements: SqlStatement[] = [
        ...movedIds.map((id, index) => ({
          sql: `UPDATE chat_entries SET conversation_id = ?, conversation_index = ? WHERE conversation_id = ? AND id = ?`,
          args: [targetConversationId, index, sourceConversationId, id] as const,
        })),
        {
          sql: `UPDATE chat_entries SET parent_id = NULL WHERE conversation_id = ? AND id = ?`,
          args: [targetConversationId, rootEntryId] as const,
        },
        // Target: record provenance, anchor on the viewed branch if it moved.
        {
          sql: `UPDATE conversations
           SET forked_from_conversation_id = ?, forked_from_entry_id = ?,
               default_view_leaf_entry_id = ?, last_message_at = ?, updated_at = ?
           WHERE id = ?`,
          args: [sourceConversationId, forkParentEntryId, targetAnchor, now, now, targetConversationId] as const,
        },
        // Source: drop a dangling anchor back to the detach point; always bump updated_at.
        sourceAnchor && movedSet.has(sourceAnchor)
          ? {
              sql: `UPDATE conversations SET default_view_leaf_entry_id = ?, updated_at = ? WHERE id = ?`,
              args: [forkParentEntryId, now, sourceConversationId] as const,
            }
          : {
              sql: `UPDATE conversations SET updated_at = ? WHERE id = ?`,
              args: [now, sourceConversationId] as const,
            },
      ];
      // One atomic write batch, cursor bump included, so the SSE watermark
      // advances with the move and a fresh snapshot reflects it.
      const results = await this.prisma.$transaction([
        ...statements.map((s) => this.prisma.$executeRawUnsafe(s.sql, ...s.args)),
        this.prisma.$queryRawUnsafe(BUMP_CURSOR_SQL),
      ]);
      const cursorRows = results[results.length - 1] as Array<{ value: number }>;
      return {
        forkParentEntryId,
        movedCount: movedIds.length,
        seq: Number(cursorRows[0]?.value ?? 0),
      };
    });
    this.cursor.note(result.seq);
    return {
      rootEntryId,
      forkParentEntryId: result.forkParentEntryId,
      movedCount: result.movedCount,
    };
  }
}
