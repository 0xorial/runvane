-- Additive: per-attempt tool execution audit (hand-written; see memory note on
-- avoiding auto-diffed migrations).
CREATE TABLE "tool_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "chat_entry_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "tool_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "retry_of_run_id" TEXT,
    "status" TEXT NOT NULL,
    "parameters_json" JSONB NOT NULL,
    "result_json" JSONB,
    "error" TEXT,
    "started_at" DATETIME NOT NULL,
    "finished_at" DATETIME,
    "elapsed_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE INDEX "tool_runs_conversation_id_idx" ON "tool_runs"("conversation_id");
CREATE INDEX "tool_runs_chat_entry_id_idx" ON "tool_runs"("chat_entry_id");
