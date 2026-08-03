-- Subagent link: a conversation spawned by run_subagent records which
-- conversation spawned it and how deep the chain is (user-created roots stay
-- at depth 0). Raw-SQL-only columns (same discipline as group_pinned /
-- tool_environment_id): absent from schema.prisma, so a `prisma migrate dev`
-- auto-diff would DROP them — hand-write any migration touching conversations.
ALTER TABLE "conversations" ADD COLUMN "parent_conversation_id" TEXT;
ALTER TABLE "conversations" ADD COLUMN "subagent_depth" INTEGER NOT NULL DEFAULT 0;
