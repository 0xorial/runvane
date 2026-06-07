import type { ChatEntry } from '../../../contracts/chatEntry.js';
import type { ConversationEntity } from '../../../conversations/conversation.entity.js';
import { toConversationRow } from '../../../conversations/conversations.api.js';
import type { ConversationRow } from '../../../contracts/conversations.js';
import type { ChatToolRules } from './rules.js';

export function resolveTargetConversationId(
  conversationId: string | undefined,
  activeConversationId: string,
): string {
  return conversationId?.trim() || activeConversationId;
}

export function assertConversationAccess(
  targetConversationId: string,
  activeConversationId: string,
  rules: ChatToolRules,
): void {
  if (targetConversationId === activeConversationId) return;
  if (!rules.allow_other_conversations) {
    throw new Error(
      `chat: access to conversation ${targetConversationId} is forbidden (allow_other_conversations=false)`,
    );
  }
}

export async function toConversationApiRow(
  entity: ConversationEntity,
  resolveDefaultViewLeaf: (conversationId: string) => Promise<string | null>,
): Promise<ConversationRow> {
  const row = toConversationRow(entity);
  row.defaultViewLeafAnchorId = entity.defaultViewLeafEntryId;
  row.defaultViewLeafEntryId = await resolveDefaultViewLeaf(entity.id);
  return row;
}

export function capChatEntries(entries: ChatEntry[], maxMessages: number): {
  messages: ChatEntry[];
  truncated: boolean;
} {
  if (entries.length <= maxMessages) {
    return { messages: entries, truncated: false };
  }
  return { messages: entries.slice(-maxMessages), truncated: true };
}
