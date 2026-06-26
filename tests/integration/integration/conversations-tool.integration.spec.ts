import { retainSharedTestApp } from '../support/shared-app';
import { ConversationsTool } from '../../../backend/src/tools/builtins/conversations/tool.js';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

describeLive('conversations tool (integration)', () => {
  let baseUrl: string;
  let conversationsTool: ConversationsTool;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
    conversationsTool = testApp.app.get(ConversationsTool);
  }, 30_000);

  it('reads messages from the active conversation and lists all conversations when allowed', async () => {
    const importRes = await fetch(`${baseUrl}/api/import/openai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        {
          title: 'Conversations tool conv A',
          messages: [
            { role: 'user', content: 'alpha user' },
            { role: 'assistant', content: 'alpha assistant' },
          ],
        },
        {
          title: 'Conversations tool conv B',
          messages: [{ role: 'user', content: 'beta user' }],
        },
      ]),
    });
    if (!importRes.ok) throw new Error(`import failed: ${importRes.status} ${await importRes.text()}`);
    const imported = (await importRes.json()) as { conversationIds?: string[] };
    const convA = imported.conversationIds?.[0];
    const convB = imported.conversationIds?.[1];
    if (!convA || !convB) throw new Error('import: expected two conversation ids');

    const context = {
      conversationId: convA,
      agentId: null,
      entries: [],
      signal: AbortSignal.timeout(10_000),
    };

    const messages = await conversationsTool.runTool({ operation: 'list_messages', all: true }, context);
    const messageRows = (messages as { messages: Array<{ type: string; text?: string }> }).messages;
    expect(messageRows.some((row) => row.type === 'user-message' && row.text === 'alpha user')).toBe(true);
    expect(messageRows.some((row) => row.type === 'assistant-message' && row.text === 'alpha assistant')).toBe(true);

    await expect(
      conversationsTool.runTool({ operation: 'list_messages', conversation_id: convB }, context),
    ).rejects.toThrow(/allow_other_conversations=false/);

    const crossChatRules = {
      allow_other_conversations: true,
      max_messages: 500,
    };
    const otherMessages = await conversationsTool.runTool(
      { operation: 'list_messages', conversation_id: convB, all: true },
      { ...context, toolRules: crossChatRules },
    );
    const otherRows = (otherMessages as { messages: Array<{ type: string; text?: string }> }).messages;
    expect(otherRows.some((row) => row.type === 'user-message' && row.text === 'beta user')).toBe(true);

    const listed = await conversationsTool.runTool(
      { operation: 'list_conversations' },
      { ...context, toolRules: crossChatRules },
    );
    const ids = (listed as { conversations: Array<{ id: string }> }).conversations.map((row) => row.id);
    expect(ids).toContain(convA);
    expect(ids).toContain(convB);

    const row = await conversationsTool.runTool({ operation: 'get_conversation', conversation_id: convA }, context);
    expect((row as { conversation: { id: string; title: string } }).conversation.title).toBe('Conversations tool conv A');
  });

  it('rejects list_conversations without cross-chat permission', async () => {
    const context = {
      conversationId: 'conv-test',
      agentId: null,
      entries: [],
      signal: AbortSignal.timeout(10_000),
    };
    await expect(conversationsTool.runTool({ operation: 'list_conversations' }, context)).rejects.toThrow(
      /allow_other_conversations=true/,
    );
  });
});

