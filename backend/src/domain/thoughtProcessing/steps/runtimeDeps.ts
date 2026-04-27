import type { ConversationEventHub } from "../../../events/conversationEventHub.js";
import type { ChatEntriesRepo } from "../../../infra/repositories/chatEntriesRepo.js";
import type { LlmProviderSettingsRepo } from "../../../infra/repositories/llmProviderSettingsRepo.js";

export type ThoughtRuntimeDeps = {
  chatEntries: ChatEntriesRepo;
  llmProviderSettings: LlmProviderSettingsRepo;
  hub: ConversationEventHub;
};

let thoughtRuntimeDeps: ThoughtRuntimeDeps | null = null;

export function configureThoughtRuntime(deps: ThoughtRuntimeDeps): void {
  thoughtRuntimeDeps = deps;
}

export function getThoughtRuntimeDeps(): ThoughtRuntimeDeps {
  if (!thoughtRuntimeDeps) throw new Error("thought runtime is not configured");
  return thoughtRuntimeDeps;
}
