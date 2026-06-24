-- Bind a conversation to a tool environment (where its runtime tools run).
-- Read/written via raw SQL; the generated Prisma client does not track it.
ALTER TABLE "conversations" ADD COLUMN "tool_environment_id" TEXT;
