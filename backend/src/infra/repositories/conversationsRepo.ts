import type { SqliteDb } from "../db/client.js";

export type ConversationRow = {
  id: string;
  title: string;
  group_name: string;
  created_at: string;
  updated_at: string;
  prompt_tokens_total: number;
  completion_tokens_total: number;
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

  list(): ConversationRow[] {
    return this.db
      .prepare(
        `SELECT
           c.id,
           c.title,
           COALESCE(g.name, trim(c.group_name), '') AS group_name,
           c.created_at,
           c.updated_at,
           COALESCE((
             SELECT SUM(COALESCE(CAST(json_extract(e.payload_json, '$.promptTokens') AS INTEGER), 0))
             FROM chat_entries e
             WHERE e.conversation_id = c.id
               AND e.type IN ('planner_llm_stream', 'title_llm_stream')
           ), 0) AS prompt_tokens_total,
           COALESCE((
             SELECT SUM(COALESCE(CAST(json_extract(e.payload_json, '$.completionTokens') AS INTEGER), 0))
             FROM chat_entries e
             WHERE e.conversation_id = c.id
               AND e.type IN ('planner_llm_stream', 'title_llm_stream')
           ), 0) AS completion_tokens_total
         FROM conversations c
         LEFT JOIN conversation_groups g ON g.id = c.group_id
         ORDER BY c.updated_at DESC`,
      )
      .all() as ConversationRow[];
  }

  get(id: string): ConversationRow | null {
    const row = this.db
      .prepare(
        `SELECT
           c.id,
           c.title,
           COALESCE(g.name, trim(c.group_name), '') AS group_name,
           c.created_at,
           c.updated_at,
           COALESCE((
             SELECT SUM(COALESCE(CAST(json_extract(e.payload_json, '$.promptTokens') AS INTEGER), 0))
             FROM chat_entries e
             WHERE e.conversation_id = c.id
               AND e.type IN ('planner_llm_stream', 'title_llm_stream')
           ), 0) AS prompt_tokens_total,
           COALESCE((
             SELECT SUM(COALESCE(CAST(json_extract(e.payload_json, '$.completionTokens') AS INTEGER), 0))
             FROM chat_entries e
             WHERE e.conversation_id = c.id
               AND e.type IN ('planner_llm_stream', 'title_llm_stream')
           ), 0) AS completion_tokens_total
         FROM conversations c
         LEFT JOIN conversation_groups g ON g.id = c.group_id
         WHERE c.id = ?`,
      )
      .get(id) as ConversationRow | undefined;
    return row ?? null;
  }

  exists(id: string): boolean {
    const row = this.db
      .prepare("SELECT 1 as ok FROM conversations WHERE id = ?")
      .get(id) as { ok?: number } | undefined;
    return row?.ok === 1;
  }

  create(titleRaw: string): ConversationRow {
    const now = new Date().toISOString();
    const title = String(titleRaw || "").trim() || "New chat";
    const row: ConversationRow = {
      id: crypto.randomUUID(),
      title,
      group_name: "",
      created_at: now,
      updated_at: now,
      prompt_tokens_total: 0,
      completion_tokens_total: 0,
    };

    this.db
      .prepare(
        `INSERT INTO conversations (id, title, group_name, group_id, created_at, updated_at)
         VALUES (@id, @title, @group_name, NULL, @created_at, @updated_at)`,
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
         WHERE id = @id`,
      )
      .run({
        id,
        title,
        updated_at: now,
      });
    if (Number(result.changes ?? 0) !== 1) return null;
    return this.get(id);
  }

  updateGroupName(id: string, groupNameRaw: string): ConversationRow | null {
    const now = new Date().toISOString();
    const group_name = String(groupNameRaw || "").trim();
    // USER_INVARIANT[RV-016]: Conversation grouping is normalized via `conversation_groups` table.
    const groupId = group_name ? this.ensureGroupIdByName(group_name) : null;
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET group_name = @group_name, group_id = @group_id, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({
        id,
        group_name,
        group_id: groupId,
        updated_at: now,
      });
    if (Number(result.changes ?? 0) !== 1) return null;
    return this.get(id);
  }
}
