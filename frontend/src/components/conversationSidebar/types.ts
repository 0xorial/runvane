export type ConversationRow = {
  id: string;
  title?: string;
  groupId?: string | null;
  isDeleted?: boolean;
  createdAt?: string;
  updatedAt?: string;
  promptTokensTotal?: number;
  cachedPromptTokensTotal?: number;
  completionTokensTotal?: number;
  tokenUsageByModel?: Array<{
    modelName: string;
    promptTokens: number;
    cachedPromptTokens: number;
    completionTokens: number;
  }>;
};

export type ConversationGroupRow = {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
};
