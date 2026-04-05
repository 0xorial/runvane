import { serve } from "@hono/node-server";

import { createRuntime } from "./bootstrap/runtime.js";
import { createApi } from "./api.js";
import { openDatabase } from "./infra/db/client.js";
import { runMigrations } from "./infra/db/migrate.js";
import { logger } from "./infra/logger.js";
import { AgentsRepo } from "./infra/repositories/agentsRepo.js";
import { ChatEntriesRepo } from "./infra/repositories/chatEntriesRepo.js";
import { ConversationsRepo } from "./infra/repositories/conversationsRepo.js";
import { LlmProviderSettingsRepo } from "./infra/repositories/llmProviderSettingsRepo.js";
import { ModelCapabilitiesRepo } from "./infra/repositories/modelCapabilitiesRepo.js";
import { ModelPresetsRepo } from "./infra/repositories/modelPresetsRepo.js";
import { TasksRepo } from "./infra/repositories/tasksRepo.js";
import { ToolExecutionLogsRepo } from "./infra/repositories/toolExecutionLogsRepo.js";
import { UploadsRepo, resolveUploadsDir } from "./infra/repositories/uploadsRepo.js";
import { LlmProviderRegistry } from "./llm_provider/registry.js";

const db = openDatabase(process.env.BACKEND2_DB_PATH);
runMigrations(db);

const agents = new AgentsRepo(db);
const conversations = new ConversationsRepo(db);
const chatEntries = new ChatEntriesRepo(db);
const llmProviderRegistry = new LlmProviderRegistry();
const llmProviderSettings = new LlmProviderSettingsRepo(db, llmProviderRegistry);
const modelPresets = new ModelPresetsRepo(db);
const modelCapabilities = new ModelCapabilitiesRepo(db);
const tasks = new TasksRepo(db);
const toolExecutionLogs = new ToolExecutionLogsRepo(db);
const uploads = new UploadsRepo(resolveUploadsDir(process.env.BACKEND2_UPLOADS_DIR));
const runtime = createRuntime({
  agents,
  conversations,
  chatEntries,
  llmProviderSettings,
  modelPresets,
  modelCapabilities,
  tasks,
  uploads,
  toolExecutionLogs,
});
const api = createApi(runtime);
const port = Number(process.env.PORT ?? "8001");

serve(
  {
    fetch: api.fetch,
    port,
  },
  (info) => {
    logger.info(
      `[backend] Hono listening on http://localhost:${info.port}`,
    );
  },
);
