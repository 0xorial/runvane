-- CreateTable
CREATE TABLE "model_presets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "parameters_json" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "model_capabilities" (
    "provider_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "supports_image_input" BOOLEAN,
    "supports_file_input" BOOLEAN,
    "max_context_tokens" INTEGER,
    "max_output_tokens" INTEGER,
    "input_cost_per_1m" REAL,
    "cached_input_cost_per_1m" REAL,
    "output_cost_per_1m" REAL,
    "currency" TEXT,
    "source" TEXT DEFAULT 'discovered',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("provider_id", "model_name")
);

-- CreateTable
CREATE TABLE "model_capability_overrides" (
    "provider_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "supports_image_input" BOOLEAN,
    "supports_file_input" BOOLEAN,
    "max_context_tokens" INTEGER,
    "max_output_tokens" INTEGER,
    "input_cost_per_1m" REAL,
    "cached_input_cost_per_1m" REAL,
    "output_cost_per_1m" REAL,
    "currency" TEXT,
    "notes" TEXT,
    "updated_by" TEXT,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("provider_id", "model_name")
);
