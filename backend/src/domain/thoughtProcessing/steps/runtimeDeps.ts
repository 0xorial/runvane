import type { ConversationEventHub } from "../../../events/conversationEventHub.js";
import type { AgentsRepo } from "../../../infra/repositories/agentsRepo.js";
import type { ChatEntriesRepo } from "../../../infra/repositories/chatEntriesRepo.js";
import type { LlmProviderSettingsRepo } from "../../../infra/repositories/llmProviderSettingsRepo.js";
import type { LlmProviderRegistry } from "../../../llm_provider/registry.js";
import type { ToolRegistry } from "../../../tools/toolRegistry.js";

export type ThoughtRuntimeDeps = {
  chatEntries: ChatEntriesRepo;
  llmProviderSettings: LlmProviderSettingsRepo;
  llmProviderRegistry: LlmProviderRegistry;
  hub: ConversationEventHub;
  agents: AgentsRepo;
  tools: ToolRegistry;
};

let thoughtRuntimeDeps: ThoughtRuntimeDeps | null = null;

export function configureThoughtRuntime(deps: ThoughtRuntimeDeps): void {
  thoughtRuntimeDeps = deps;
}

export function getThoughtRuntimeDeps(): ThoughtRuntimeDeps {
  if (!thoughtRuntimeDeps) throw new Error("thought runtime is not configured");
  return thoughtRuntimeDeps;
}
