import type { SqliteDb } from "../db/client.js";
import { parseJsonObject } from "./json.js";

export type TaskRow = {
  id: number;
  task_type: string;
  payload: Record<string, unknown>;
  is_done: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
};

export const TASK_CANCELLED_BY_USER = "cancelled_by_user";

type TaskDbRow = {
  id: number;
  task_type: string;
  payload_json: string;
  is_done: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
};

function toRow(row: TaskDbRow): TaskRow {
  return {
    id: row.id,
    task_type: row.task_type,
    payload: parseJsonObject(row.payload_json),
    is_done: row.is_done === 1,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    last_error: row.last_error,
  };
}

export class TasksRepo {
  constructor(private readonly db: SqliteDb) {}

  create(input: { task_type: string; payload: Record<string, unknown> }): TaskRow {
    const now = new Date().toISOString();
    const inserted = this.db
      .prepare(
        `INSERT INTO tasks (task_type, payload_json, is_done, created_at)
         VALUES (@task_type, @payload_json, 0, @created_at)`,
      )
      .run({
        task_type: input.task_type,
        payload_json: JSON.stringify(input.payload),
        created_at: now,
      });
    const id = Number(inserted.lastInsertRowid);
    const row = this.getById(id);
    if (!row) throw new Error("failed to load inserted task");
    return row;
  }

  getById(id: number): TaskRow | null {
    const row = this.db
      .prepare(
        `SELECT id, task_type, payload_json, is_done, created_at, started_at, finished_at, last_error
         FROM tasks
         WHERE id = ?`,
      )
      .get(id) as TaskDbRow | undefined;
    return row ? toRow(row) : null;
  }

  markStarted(id: number): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE tasks
         SET started_at = @started_at, last_error = NULL
         WHERE id = @id AND is_done = 0 AND started_at IS NULL`,
      )
      .run({ id, started_at: now });
    return result.changes > 0;
  }

  markDone(id: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE tasks
         SET is_done = 1, finished_at = @finished_at, last_error = NULL
         WHERE id = @id AND is_done = 0`,
      )
      .run({ id, finished_at: now });
  }

  markFailed(id: number, detail: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE tasks
         SET finished_at = @finished_at, last_error = @last_error
         WHERE id = @id AND is_done = 0`,
      )
      .run({ id, finished_at: now, last_error: detail });
  }

  isCancelledByUser(id: number): boolean {
    const row = this.getById(id);
    return row?.is_done === true && row.last_error === TASK_CANCELLED_BY_USER;
  }

  hasUnfinishedRunToolTasksInBatch(batchId: string, excludeTaskId?: number): boolean {
    const normalizedBatchId = String(batchId ?? "").trim();
    if (!normalizedBatchId) return false;
    const row = this.db
      .prepare(
        `SELECT 1 AS has_pending
         FROM tasks
         WHERE task_type = 'run_tool'
           AND finished_at IS NULL
           AND json_extract(payload_json, '$.batchId') = @batch_id
           AND (@exclude_id IS NULL OR id != @exclude_id)
         LIMIT 1`,
      )
      .get({
        batch_id: normalizedBatchId,
        exclude_id: typeof excludeTaskId === "number" ? excludeTaskId : null,
      }) as { has_pending?: number } | undefined;
    return row?.has_pending === 1;
  }

  cancelOpenByConversationId(conversationId: string): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE tasks
         SET is_done = 1,
             finished_at = @finished_at,
             last_error = @last_error
         WHERE is_done = 0
           AND json_extract(payload_json, '$.conversationId') = @conversation_id`,
      )
      .run({
        finished_at: now,
        last_error: TASK_CANCELLED_BY_USER,
        conversation_id: conversationId,
      });
    return Number(result.changes ?? 0);
  }
}
