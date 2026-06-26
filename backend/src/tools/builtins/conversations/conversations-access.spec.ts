import type { ChatEntry } from '../../../contracts/chatEntry.js';
import {
  assertConversationAccess,
  capChatEntries,
  resolveTargetConversationId,
} from './conversations-access.js';
import type { ConversationsToolRules } from './rules.js';

const baseRules: ConversationsToolRules = {
  allow_other_conversations: false,
  max_messages: 500,
};

describe('conversations access helpers', () => {
  it('defaults target conversation to active chat', () => {
    expect(resolveTargetConversationId(undefined, 'active-id')).toBe('active-id');
    expect(resolveTargetConversationId('other-id', 'active-id')).toBe('other-id');
  });

  it('forbids other conversations when rule is false', () => {
    expect(() => assertConversationAccess('other-id', 'active-id', baseRules)).toThrow(
      /allow_other_conversations=false/,
    );
    expect(() => assertConversationAccess('active-id', 'active-id', baseRules)).not.toThrow();
  });

  it('caps messages from the end and marks truncated', () => {
    const entries = [
      { id: '1', type: 'user-message' },
      { id: '2', type: 'assistant-message' },
      { id: '3', type: 'user-message' },
    ] as ChatEntry[];
    const capped = capChatEntries(entries, 2);
    expect(capped.truncated).toBe(true);
    expect(capped.messages.map((entry) => entry.id)).toEqual(['2', '3']);
  });
});
