-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "active_leaf_entry_id" TEXT;

-- CreateIndex
CREATE INDEX "chat_entries_parent_id_idx" ON "chat_entries"("parent_id");

-- Backfill: point each conversation's active leaf to its latest entry
UPDATE "conversations"
SET "active_leaf_entry_id" = (
  SELECT e."id"
  FROM "chat_entries" e
  WHERE e."conversation_id" = "conversations"."id"
  ORDER BY e."conversation_index" DESC
  LIMIT 1
)
WHERE "active_leaf_entry_id" IS NULL;
