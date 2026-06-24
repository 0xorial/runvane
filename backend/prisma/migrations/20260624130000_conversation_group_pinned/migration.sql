-- Pin/lock a conversation's group assignment against automatic categorization.
-- Set to 1 whenever the user manually changes the group (or explicitly pins);
-- cleared when the user unpins. The auto-categorizer only assigns/moves a
-- conversation's group when this is 0, so manual organization is never
-- overwritten. Like the fork-link columns, this is accessed via raw SQL and is
-- intentionally absent from the generated Prisma client.
ALTER TABLE "conversations" ADD COLUMN "group_pinned" INTEGER NOT NULL DEFAULT 0;
