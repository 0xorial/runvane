import type { ConversationEntity } from '../conversations/conversation.entity.js';
import type { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import type { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import type { ConversationSseRow, SseEvent } from '../contracts/sse.js';
import { SseType } from '../contracts/sse.js';
import type { SseHubService } from './sse-hub.service.js';

export function incrementalDelta(prev: string, next: string): string {
  if (!next) return '';
  if (!prev) return next;
  if (next.startsWith(prev)) return next.slice(prev.length);
  return next;
}

export function toConversationSseRow(entity: ConversationEntity): ConversationSseRow {
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
    tokenUsageByModel: [],
  };
}

export async function publishConversationUpdated(
  hub: SseHubService,
  conversations: ConversationsRepo,
  conversationId: string,
): Promise<SseEvent> {
  const entity = await conversations.get(conversationId, { includeDeleted: true });
  if (!entity) throw new Error(`conversation not found: ${conversationId}`);
  return hub.publish(conversationId, {
    type: SseType.CONVERSATION_UPDATED,
    conversation: toConversationSseRow(entity),
  });
}

export async function publishChatEntryUpsert(
  hub: SseHubService,
  chatEntries: ChatEntriesRepo,
  conversationId: string,
  entryId: string,
): Promise<void> {
  const entry = await chatEntries.getChatEntry(conversationId, entryId);
  if (!entry) throw new Error(`chat entry not found: ${conversationId}/${entryId}`);
  hub.publish(conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry });
}

