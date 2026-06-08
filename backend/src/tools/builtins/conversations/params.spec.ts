import { parseConversationsToolParams } from './params.js';

describe('parseConversationsToolParams', () => {
  it('accepts list_conversations', () => {
    expect(parseConversationsToolParams({ operation: 'list_conversations' }).operation).toBe('list_conversations');
  });

  it('accepts list_messages with all flag', () => {
    const params = parseConversationsToolParams({
      operation: 'list_messages',
      conversation_id: 'abc',
      all: true,
    });
    expect(params.all).toBe(true);
    expect(params.conversation_id).toBe('abc');
  });
});
