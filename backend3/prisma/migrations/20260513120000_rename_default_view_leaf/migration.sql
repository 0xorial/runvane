-- Rename hint column: it's only the user's default branch view, not an authoritative leaf.
ALTER TABLE "conversations" RENAME COLUMN "active_leaf_entry_id" TO "default_view_leaf_entry_id";
