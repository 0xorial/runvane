-- Side-lane marker for chat entries. Side entries (title/categorize/attachment-summary
-- thoughts, params-resolution and guardrail thoughts) hang off their anchor entry for
-- display but do NOT participate in branch semantics: branch walks and fork counting
-- consider spine (is_side = 0) children only. Hand-written additive ALTER (never let
-- `migrate dev` auto-diff this table).
ALTER TABLE "chat_entries" ADD COLUMN "is_side" INTEGER NOT NULL DEFAULT 0;
