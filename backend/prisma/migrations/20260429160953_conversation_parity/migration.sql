-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "group_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_message_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prompt_tokens_total" INTEGER NOT NULL DEFAULT 0,
    "cached_prompt_tokens_total" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens_total" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "conversations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "conversation_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "conversation_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_groups_name_key" ON "conversation_groups"("name");
