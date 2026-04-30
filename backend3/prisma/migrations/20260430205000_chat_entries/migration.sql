-- CreateTable
CREATE TABLE "chat_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "conversation_index" INTEGER NOT NULL,
    "parent_id" TEXT,
    "type" TEXT NOT NULL,
    "payload_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_entries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "chat_entries_conversation_id_conversation_index_idx" ON "chat_entries"("conversation_id", "conversation_index");
