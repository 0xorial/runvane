import type { ConversationEntity } from '../conversations/conversation.entity.js';
import type { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import type { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import type { ChatEntryDeltaField, ConversationSseRow, SseEvent } from '../contracts/sse.js';
import { SseType } from '../contracts/sse.js';
import type { LlmStreamEvent } from '../llmProviders/types.js';
import { toClientChatEntry } from '../thoughtProcessing/inputSnapshot.js';
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
    defaultViewLeafAnchorId: entity.defaultViewLeafEntryId,
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
  hub.publish(conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry: toClientChatEntry(entry) });
}

/**
 * Forward an LLM stream event onto a thought stream entry as a CHAT_ENTRY_DELTA.
 * Currently routes:
 *   - `text_delta`     → `llmResponse`
 *   - `thinking_delta` → `thinkingText`
 * Returns true if the event produced a delta (caller can chain extra side-effects
 * on text deltas only, e.g. live assistant-message streaming in the planner).
 */
export function publishStreamFieldDelta(
  hub: SseHubService,
  conversationId: string,
  chatEntryId: string,
  event: LlmStreamEvent,
): boolean {
  const field = streamFieldFor(event);
  if (!field || !('delta' in event) || !event.delta) return false;
  hub.publish(conversationId, { type: SseType.CHAT_ENTRY_DELTA, chatEntryId, field, delta: event.delta });
  return true;
}

function streamFieldFor(event: LlmStreamEvent): ChatEntryDeltaField | null {
  if (event.type === 'text_delta') return 'llmResponse';
  if (event.type === 'thinking_delta') return 'thinkingText';
  return null;
}

