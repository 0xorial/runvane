import type { SqliteDb } from "../db/client.js";

export type ConversationRow = {
  id: string;
  title: string;
  group_id: string | null;
  is_deleted: number;
  created_at: string;
  updated_at: string;
  prompt_tokens_total: number;
  cached_prompt_tokens_total: number;
  completion_tokens_total: number;
};

export type ConversationGroupRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export class ConversationsRepo {
  constructor(private readonly db: SqliteDb) {}

  private ensureGroupIdByName(groupNameRaw: string): string {
    const name = String(groupNameRaw || "").trim();
    if (!name) throw new Error("group name is required");

    const existing = this.db
      .prepare("SELECT id FROM conversation_groups WHERE name = ?")
      .get(name) as { id?: string } | undefined;
    if (typeof existing?.id === "string" && existing.id) return existing.id;

    const now = new Date().toISOString();
    const createdId = crypto.randomUUID();
    try {
      this.db
        .prepare(
          `INSERT INTO conversation_groups (id, name, created_at, updated_at)
           VALUES (@id, @name, @created_at, @updated_at)`,
        )
        .run({
          id: createdId,
          name,
          created_at: now,
          updated_at: now,
        });
      return createdId;
    } catch (e) {
      const retried = this.db
        .prepare("SELECT id FROM conversation_groups WHERE name = ?")
        .get(name) as { id?: string } | undefined;
      if (typeof retried?.id === "string" && retried.id) return retried.id;
      throw new Error(`failed to ensure conversation group "${name}"`, { cause: e });
    }
  }

  list(options?: { deletedOnly?: boolean }): ConversationRow[] {
    const deletedOnly = options?.deletedOnly === true ? 1 : 0;
    return this.db
      .prepare(
        `SELECT
           c.id,
           c.title,
           c.group_id,
           c.is_deleted,
           c.created_at,
           c.updated_at,
           COALESCE((
             SELECT SUM(COALESCE(CAST(json_extract(e.payload_json, '$.promptTokens') AS INTEGER), 0))
             FROM chat_entries e
             WHERE e.conversation_id = c.id
               AND e.type IN ('planner_llm_stream', 'title_llm_stream')
           ), 0) AS prompt_tokens_total,
           COALESCE((
             SELECT SUM(COALESCE(CAST(json_extract(e.payload_json, '$.cachedPromptTokens') AS INTEGER), 0))
             FROM chat_entries e
             WHERE e.conversation_id = c.id
               AND e.type IN ('planner_llm_stream', 'title_llm_stream')
           ), 0) AS cached_prompt_tokens_total,
           COALESCE((
             SELECT SUM(COALESCE(CAST(json_extract(e.payload_json, '$.completionTokens') AS INTEGER), 0))
             FROM chat_entries e
             WHERE e.conversation_id = c.id
               AND e.type IN ('planner_llm_stream', 'title_llm_stream')
           ), 0) AS completion_tokens_total
         FROM conversations c
         WHERE c.is_deleted = @deleted_only
         ORDER BY c.updated_at DESC`,
      )
      .all({ deleted_only: deletedOnly }) as ConversationRow[];
  }

  get(id: string, options?: { includeDeleted?: boolean }): ConversationRow | null {
    const includeDeleted = options?.includeDeleted === true ? 1 : 0;
    const row = this.db
      .prepare(
        `SELECT
           c.id,
           c.title,
           c.group_id,
           c.is_deleted,
           c.created_at,
           c.updated_at,
           COALESCE((
             SELECT SUM(COALESCE(CAST(json_extract(e.payload_json, '$.promptTokens') AS INTEGER), 0))
             FROM chat_entries e
             WHERE e.conversation_id = c.id
               AND e.type IN ('planner_llm_stream', 'title_llm_stream')
           ), 0) AS prompt_tokens_total,
           COALESCE((
             SELECT SUM(COALESCE(CAST(json_extract(e.payload_json, '$.cachedPromptTokens') AS INTEGER), 0))
             FROM chat_entries e
             WHERE e.conversation_id = c.id
               AND e.type IN ('planner_llm_stream', 'title_llm_stream')
           ), 0) AS cached_prompt_tokens_total,
           COALESCE((
             SELECT SUM(COALESCE(CAST(json_extract(e.payload_json, '$.completionTokens') AS INTEGER), 0))
             FROM chat_entries e
             WHERE e.conversation_id = c.id
               AND e.type IN ('planner_llm_stream', 'title_llm_stream')
           ), 0) AS completion_tokens_total
         FROM conversations c
         WHERE c.id = @id
           AND (@include_deleted = 1 OR c.is_deleted = 0)`,
      )
      .get({
        id,
        include_deleted: includeDeleted,
      }) as ConversationRow | undefined;
    return row ?? null;
  }

  listGroups(): ConversationGroupRow[] {
    return this.db
      .prepare(
        `SELECT id, name, created_at, updated_at
         FROM conversation_groups
         ORDER BY name COLLATE NOCASE ASC`,
      )
      .all() as ConversationGroupRow[];
  }

  exists(id: string, options?: { includeDeleted?: boolean }): boolean {
    const includeDeleted = options?.includeDeleted === true ? 1 : 0;
    const row = this.db
      .prepare(
        `SELECT 1 as ok
         FROM conversations
         WHERE id = @id
           AND (@include_deleted = 1 OR is_deleted = 0)`,
      )
      .get({
        id,
        include_deleted: includeDeleted,
      }) as { ok?: number } | undefined;
    return row?.ok === 1;
  }

  create(titleRaw: string): ConversationRow {
    const now = new Date().toISOString();
    const title = String(titleRaw || "").trim() || "New chat";
    const row: ConversationRow = {
      id: crypto.randomUUID(),
      title,
      group_id: null,
      is_deleted: 0,
      created_at: now,
      updated_at: now,
      prompt_tokens_total: 0,
      cached_prompt_tokens_total: 0,
      completion_tokens_total: 0,
    };

    this.db
      .prepare(
        `INSERT INTO conversations (id, title, group_id, is_deleted, created_at, updated_at)
         VALUES (@id, @title, NULL, 0, @created_at, @updated_at)`,
      )
      .run(row);

    return row;
  }

  updateTitle(id: string, titleRaw: string): ConversationRow | null {
    const now = new Date().toISOString();
    const title = String(titleRaw || "").trim();
    if (!title) return null;
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET title = @title, updated_at = @updated_at
         WHERE id = @id
           AND is_deleted = 0`,
      )
      .run({
        id,
        title,
        updated_at: now,
      });
    if (Number(result.changes ?? 0) !== 1) return null;
    return this.get(id, { includeDeleted: true });
  }

  updateGroupName(id: string, groupNameRaw: string): ConversationRow | null {
    const now = new Date().toISOString();
    const group_name = String(groupNameRaw || "").trim();
    const groupId = group_name ? this.ensureGroupIdByName(group_name) : null;
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET group_id = @group_id, updated_at = @updated_at
         WHERE id = @id
           AND is_deleted = 0`,
      )
      .run({
        id,
        group_id: groupId,
        updated_at: now,
      });
    if (Number(result.changes ?? 0) !== 1) return null;
    return this.get(id, { includeDeleted: true });
  }

  updateGroupId(id: string, groupIdRaw: string | null): ConversationRow | null {
    const now = new Date().toISOString();
    const groupId = typeof groupIdRaw === "string" ? groupIdRaw.trim() : "";
    const normalizedGroupId = groupId ? groupId : null;
    if (normalizedGroupId) {
      const existing = this.db
        .prepare("SELECT id FROM conversation_groups WHERE id = ?")
        .get(normalizedGroupId) as { id?: string } | undefined;
      if (!existing?.id) {
        throw new Error(`conversation group not found: ${normalizedGroupId}`);
      }
    }
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET group_id = @group_id, updated_at = @updated_at
         WHERE id = @id
           AND is_deleted = 0`,
      )
      .run({
        id,
        group_id: normalizedGroupId,
        updated_at: now,
      });
    if (Number(result.changes ?? 0) !== 1) return null;
    return this.get(id, { includeDeleted: true });
  }

  softDelete(id: string): ConversationRow | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET is_deleted = 1, updated_at = @updated_at
         WHERE id = @id
           AND is_deleted = 0`,
      )
      .run({
        id,
        updated_at: now,
      });
    if (Number(result.changes ?? 0) !== 1) return null;
    return this.get(id, { includeDeleted: true });
  }

  undelete(id: string): ConversationRow | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET is_deleted = 0, updated_at = @updated_at
         WHERE id = @id
           AND is_deleted = 1`,
      )
      .run({
        id,
        updated_at: now,
      });
    if (Number(result.changes ?? 0) !== 1) return null;
    return this.get(id, { includeDeleted: true });
  }

  hardDelete(id: string): boolean {
    const tx = this.db.transaction((conversationId: string) => {
      this.db
        .prepare(
          `DELETE FROM tool_execution_logs
           WHERE conversation_id = ?`,
        )
        .run(conversationId);
      this.db
        .prepare(
          `DELETE FROM chat_entries
           WHERE conversation_id = ?`,
        )
        .run(conversationId);
      const removed = this.db
        .prepare(
          `DELETE FROM conversations
           WHERE id = ?
             AND is_deleted = 1`,
        )
        .run(conversationId);
      return Number(removed.changes ?? 0) === 1;
    });
    return tx(id);
  }
}
