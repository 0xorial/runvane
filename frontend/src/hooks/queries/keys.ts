export const queryKeys = {
  agents: ["agents"] as const,
  modelCapabilities: ["model-capabilities"] as const,
  modelPresets: ["model-presets"] as const,
  llmProviders: ["llm-providers"] as const,
  tools: ["tools"] as const,
  conversationConfig: ["conversation-config"] as const,
  conversationList: (deletedOnly: boolean) => ["conversations", { deletedOnly }] as const,
  conversation: (conversationId: string) => ["conversation", conversationId] as const,
  conversationSession: (conversationId: string) => ["conversation-session", conversationId] as const,
};
