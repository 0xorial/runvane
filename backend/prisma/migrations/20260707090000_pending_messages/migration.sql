-- Additive: durable queue for messages posted while a run is in flight.
CREATE TABLE "pending_messages" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" TEXT NOT NULL,
    "client_request_id" TEXT,
    "dto_json" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "pending_messages_conversation_id_seq_idx" ON "pending_messages"("conversation_id", "seq");
