import type { SqliteDb } from "../db/client.js";

export type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export class ConversationsRepo {
  constructor(private readonly db: SqliteDb) {}

  list(): ConversationRow[] {
    return this.db
      .prepare(
        `SELECT id, title, created_at, updated_at
         FROM conversations
         ORDER BY updated_at DESC`,
      )
      .all() as ConversationRow[];
  }

  get(id: string): ConversationRow | null {
    const row = this.db
      .prepare(
        `SELECT id, title, created_at, updated_at
         FROM conversations
         WHERE id = ?`,
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
      created_at: now,
      updated_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at)
         VALUES (@id, @title, @created_at, @updated_at)`,
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
}
