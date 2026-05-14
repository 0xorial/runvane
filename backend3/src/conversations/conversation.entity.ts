export type ConversationEntity = {
  id: string;
  title: string;
  groupId: string | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  promptTokensTotal: number;
  cachedPromptTokensTotal: number;
  completionTokensTotal: number;
  defaultViewLeafEntryId: string | null;
};

export type CreateConversationInput = {
  title?: string;
};

export type ConversationGroupEntity = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};
