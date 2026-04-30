import type { LlmProviderRegistry } from '../../llmProviders/registry.js';
import type { ProviderSettingsDict } from '../../llmProviders/provider.js';

export type RuntimeChatEntry = {
  id: string;
  type: string;
  text?: string;
  parentId?: string | null;
  agentId?: string | null;
};

export type RuntimeChatEntriesRepo = {
  listMessages: (conversationId: string) => RuntimeChatEntry[];
  getMessage: (conversationId: string, entryId: string) => RuntimeChatEntry | null;
  appendAssistantMessage: (conversationId: string, text: string, input?: { parentId?: string }) => { id: string };
  updateAssistantMessage: (conversationId: string, input: { id: string; text: string }) => void;
};

export type RuntimeAgentsRepo = {
  get: (agentId: string | null | undefined) => { systemPrompt?: string } | null;
};

export type RuntimeToolsRegistry = {
  list: () => Array<{ getName: () => string; isEnabledForAgent?: (agentId: string | null) => boolean }>;
};

export type RuntimeHub = {
  publish: (conversationId: string, payload: Record<string, unknown>) => void;
};

export type RuntimeLlmProviderSettingsRepo = {
  getDocument: () => Promise<{ llm_configuration: { provider_id: string; model_name: string } }>;
  getProviderSettings: (providerId: string) => Promise<ProviderSettingsDict | null>;
};

export type ThoughtRuntimeDeps = {
  chatEntries: RuntimeChatEntriesRepo;
  llmProviderSettings: RuntimeLlmProviderSettingsRepo;
  llmProviderRegistry: LlmProviderRegistry;
  hub: RuntimeHub;
  agents: RuntimeAgentsRepo;
  tools: RuntimeToolsRegistry;
};

let thoughtRuntimeDeps: ThoughtRuntimeDeps | null = null;

export function configureThoughtRuntime(deps: ThoughtRuntimeDeps): void {
  thoughtRuntimeDeps = deps;
}

export function getThoughtRuntimeDeps(): ThoughtRuntimeDeps {
  if (!thoughtRuntimeDeps) throw new Error('thought runtime is not configured');
  return thoughtRuntimeDeps;
}
