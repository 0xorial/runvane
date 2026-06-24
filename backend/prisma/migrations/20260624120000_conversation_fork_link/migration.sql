-- Split-to-new-conversation provenance. When a conversation is created by
-- splitting a subtree out of another, it records where its context came from:
--   forked_from_conversation_id — the source conversation
--   forked_from_entry_id        — the entry in the source the split detached
--                                 from (the parent that stayed behind), or NULL
-- Both NULL for normally-created conversations.
ALTER TABLE "conversations" ADD COLUMN "forked_from_conversation_id" TEXT;
ALTER TABLE "conversations" ADD COLUMN "forked_from_entry_id" TEXT;

-- Look up "what was split off from this conversation" without a table scan.
CREATE INDEX "conversations_forked_from_conversation_id_idx"
  ON "conversations"("forked_from_conversation_id");
