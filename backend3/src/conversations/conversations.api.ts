import type { ConversationEntity, ConversationGroupEntity } from './conversation.entity.js';

export type ConversationUsageByModel = {
  modelName: string;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
};

export type ConversationRow = {
  id: string;
  title: string;
  groupId: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  promptTokensTotal: number;
  cachedPromptTokensTotal: number;
  completionTokensTotal: number;
  activeLeafEntryId: string | null;
  tokenUsageByModel: ConversationUsageByModel[];
};

export type ConversationGroupRow = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type GetConversationsResponse = {
  conversations: ConversationRow[];
  groups: ConversationGroupRow[];
};

export function toConversationRow(entity: ConversationEntity): ConversationRow {
  return {
    id: entity.id,
    title: entity.title,
    groupId: entity.groupId,
    isDeleted: entity.isDeleted,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    lastMessageAt: entity.lastMessageAt.toISOString(),
    promptTokensTotal: entity.promptTokensTotal,
    cachedPromptTokensTotal: entity.cachedPromptTokensTotal,
    completionTokensTotal: entity.completionTokensTotal,
    activeLeafEntryId: entity.activeLeafEntryId,
    tokenUsageByModel: [],
  };
}

export function toConversationGroupRow(entity: ConversationGroupEntity): ConversationGroupRow {
  return {
    id: entity.id,
    name: entity.name,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
