import { parseChatToolParams } from './params.js';

describe('parseChatToolParams', () => {
  it('accepts list_conversations', () => {
    expect(parseChatToolParams({ operation: 'list_conversations' }).operation).toBe('list_conversations');
  });

  it('accepts list_messages with all flag', () => {
    const params = parseChatToolParams({
      operation: 'list_messages',
      conversation_id: 'abc',
      all: true,
    });
    expect(params.all).toBe(true);
    expect(params.conversation_id).toBe('abc');
  });
});
