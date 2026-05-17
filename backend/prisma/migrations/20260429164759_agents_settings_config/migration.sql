-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL DEFAULT '',
    "default_llm_configuration_json" JSONB,
    "default_model_preset_id" INTEGER,
    "model_provider_id" TEXT,
    "model_name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "llm_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "settings_json" JSONB NOT NULL,
    "models_json" JSONB NOT NULL,
    "models_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value_json" JSONB NOT NULL,
    "updated_at" DATETIME NOT NULL
);
