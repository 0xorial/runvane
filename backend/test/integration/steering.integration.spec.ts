import { retainSharedTestApp } from '../support/shared-app';
import {
  createConversation,
  getDefaultAgentId,
  INTEGRATION_LLM_TIMEOUT_MS,
  listAllMessages,
  postConversationMessage,
  sleep,
} from '../support/http';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

describeLive('steering (integration)', () => {
  let baseUrl: string;
  let agentId: string;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
    agentId = await getDefaultAgentId(baseUrl);
  }, 30_000);

  it('steer aborts slow in-flight run and processes the steer message', async () => {
    const conversationId = await createConversation(baseUrl);
    void postConversationMessage(
      baseUrl,
      conversationId,
      agentId,
      '__stub_delay:800__ slow start',
    );

    const userDeadline = Date.now() + 2_000;
    let parentId: string | null = null;
    while (Date.now() < userDeadline) {
      const entries = await listAllMessages(baseUrl, conversationId);
      const user = entries.find((entry) => entry.type === 'user-message');
      if (user) {
        parentId = user.id;
        break;
      }
      await sleep(10);
    }
    if (!parentId) throw new Error('steer test: first user message never appeared');

    await postConversationMessage(baseUrl, conversationId, agentId, '__steer_probe__ redirect', {
      steer: true,
      parentId,
    });

    const deadline = Date.now() + INTEGRATION_LLM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const entries = await listAllMessages(baseUrl, conversationId);
      const assistant = entries.find(
        (entry) =>
          entry.type === 'assistant-message' &&
          String(entry.text || '').includes('Steered response.'),
      );
      if (assistant) {
        const userMessages = entries.filter((entry) => entry.type === 'user-message');
        expect(userMessages.length).toBeGreaterThanOrEqual(2);
        return;
      }
      await sleep(10);
    }
    throw new Error('timeout waiting for steered assistant response');
  }, INTEGRATION_LLM_TIMEOUT_MS + 5_000);
});
