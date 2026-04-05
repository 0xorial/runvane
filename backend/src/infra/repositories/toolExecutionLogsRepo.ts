import type { SqliteDb } from "../db/client.js";

export class ToolExecutionLogsRepo {
  constructor(private readonly db: SqliteDb) {}

  append(input: {
    taskId?: number | null;
    conversationId: string;
    toolName: string;
    phase: string;
    payload: Record<string, unknown>;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO tool_execution_logs (
           task_id,
           conversation_id,
           tool_name,
           phase,
           payload_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.taskId ?? null,
        input.conversationId,
        input.toolName,
        input.phase,
        JSON.stringify(input.payload ?? {}),
        now,
      );
  }
}
