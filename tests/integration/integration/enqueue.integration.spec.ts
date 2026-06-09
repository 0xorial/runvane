import { retainSharedTestApp } from '../support/shared-app';
import {
  ChatEntryRow,
  createConversation,
  getDefaultAgentId,
  INTEGRATION_LLM_TIMEOUT_MS,
  listAllMessages,
  postConversationMessage,
  sleep,
} from '../support/http';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

/** Walk parentId pointers up from `startId`; true if `ancestorId` is reached. */
function isDescendantOf(entries: ChatEntryRow[], startId: string, ancestorId: string): boolean {
  const byId = new Map(entries.map((e) => [e.id, e]));
  let cursor: string | null = byId.get(startId)?.parentId ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

describeLive('enqueue (integration)', () => {
  let baseUrl: string;
  let agentId: string;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
    agentId = await getDefaultAgentId(baseUrl);
  }, 30_000);

  it('enqueued message waits for the in-flight run, then continues the conversation linearly', async () => {
    const conversationId = await createConversation(baseUrl);
    // Slow first run so we have a window to enqueue while it's in flight.
    void postConversationMessage(baseUrl, conversationId, agentId, '__stub_delay:800__ slow start');

    // Wait for the first user message to land (run is now active and delaying).
    const userDeadline = Date.now() + 2_000;
    let firstUserId: string | null = null;
    while (Date.now() < userDeadline) {
      const entries = await listAllMessages(baseUrl, conversationId);
      const user = entries.find((e) => e.type === 'user-message');
      if (user) {
        firstUserId = user.id;
        break;
      }
      await sleep(10);
    }
    if (!firstUserId) throw new Error('enqueue test: first user message never appeared');

    // Enqueue while the first run is still delaying — must NOT abort it.
    await postConversationMessage(baseUrl, conversationId, agentId, 'queued follow-up', {
      enqueue: true,
    });

    // Both runs should complete: first was not aborted (→ its assistant exists),
    // and the queued message drained into its own run (→ second assistant).
    const deadline = Date.now() + INTEGRATION_LLM_TIMEOUT_MS * 2;
    while (Date.now() < deadline) {
      const entries = await listAllMessages(baseUrl, conversationId);
      const users = entries
        .filter((e) => e.type === 'user-message')
        .sort((a, b) => a.conversationIndex - b.conversationIndex);
      const assistants = entries.filter((e) => e.type === 'assistant-message');

      if (users.length >= 2 && assistants.length >= 2) {
        const queuedUser = users.find((u) => String(u.text || '').includes('queued follow-up'));
        expect(queuedUser).toBeDefined();
        // The slow first message survived (wasn't replaced/aborted like steer).
        expect(String(users[0].text || '')).toContain('slow start');
        // The queued message continued the conversation: it's a descendant of the
        // first user message, not a sibling branch off the same parent.
        expect(isDescendantOf(entries, queuedUser!.id, firstUserId)).toBe(true);
        return;
      }
      await sleep(10);
    }
    throw new Error('timeout waiting for enqueued message to drain and complete');
  }, INTEGRATION_LLM_TIMEOUT_MS * 2 + 5_000);
});
