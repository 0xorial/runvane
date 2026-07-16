export const queryKeys = {
  agents: ["agents"] as const,
  modelCapabilities: ["model-capabilities"] as const,
  liveModelPricing: (providerId: string) => ["live-model-pricing", providerId] as const,
  modelPresets: ["model-presets"] as const,
  llmProviders: ["llm-providers"] as const,
  tools: ["tools"] as const,
  toolSandboxes: ["tool-sandboxes"] as const,
  conversationConfig: ["conversation-config"] as const,
  conversationList: (deletedOnly: boolean, limit?: number) =>
    ["conversations", { deletedOnly, limit: limit ?? null }] as const,
  conversation: (conversationId: string) => ["conversation", conversationId] as const,
  conversationSession: (conversationId: string) => ["conversation-session", conversationId] as const,
};
