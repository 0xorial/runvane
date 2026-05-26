ALTER TABLE "agents" ADD COLUMN "is_default" INTEGER NOT NULL DEFAULT 0;

-- At most one agent may be marked default. Partial unique index enforces it
-- only over the truthy rows so the column can otherwise stay 0 on every row.
CREATE UNIQUE INDEX "agents_is_default_unique" ON "agents" ("is_default") WHERE "is_default" = 1;
