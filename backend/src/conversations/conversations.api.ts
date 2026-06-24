import type { ConversationEntity, ConversationGroupEntity } from './conversation.entity.js';
import type {
  ConversationRow,
  ConversationGroupRow,
  GetConversationsResponse,
} from '../contracts/conversations.js';

// Re-export so consumers that currently import from this module don't break.
export type { ConversationRow, ConversationGroupRow, GetConversationsResponse };

export function toConversationRow(
  entity: ConversationEntity,
  tokenUsageByModel: ConversationRow['tokenUsageByModel'] = [],
): ConversationRow {
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
    defaultViewLeafAnchorId: entity.defaultViewLeafEntryId,
    defaultViewLeafEntryId: null,
    // Fork provenance lives in columns the generated Prisma client doesn't know
    // about; the service overrides these via a raw lookup in toApiRow.
    forkedFromConversationId: null,
    forkedFromEntryId: null,
    forkedFromConversationTitle: null,
    tokenUsageByModel,
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
