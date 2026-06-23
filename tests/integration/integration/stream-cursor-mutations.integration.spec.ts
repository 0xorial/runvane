import { ChatEntriesRepo } from '../../../backend/src/db/repositories/chat-entries.repo';
import { StreamCursorService } from '../../../backend/src/db/stream-cursor.service';
import { retainSharedTestApp } from '../support/shared-app';
import { createConversation, getDefaultAgentId } from '../support/http';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeMaybe = runLive ? describe : describe.skip;

/**
 * The stream cursor is the seq stamped on every live SSE event AND the
 * snapshot watermark W. The client gates `seq > W`, so EVERY published entry
 * mutation must bump the cursor in its write txn — otherwise its frame rides a
 * stale seq, a snapshot taken just before it (same W) drops it, and the change
 * is lost on the client. The reparent case is the one that bit us: ChatChain
 * splices a late thought step in by reparenting the intervening entry, and if
 * that reparent didn't bump, the spliced fork froze into two sibling branches
 * (title + planner) in the UI.
 */
describeMaybe('stream cursor: every entry mutation advances the cursor (integration)', () => {
  let repo: ChatEntriesRepo;
  let cursor: StreamCursorService;
  let baseUrl: string;
  let agentId: string;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
    repo = testApp.app.get(ChatEntriesRepo);
    cursor = testApp.app.get(StreamCursorService);
    agentId = await getDefaultAgentId(baseUrl);
  }, 30_000);

  async function cursorDeltaAround(fn: () => Promise<unknown>): Promise<number> {
    const before = cursor.current();
    await fn();
    return cursor.current() - before;
  }

  it('reparent (the ChatChain splice) advances the cursor', async () => {
    const conversationId = await createConversation(baseUrl);
    const user = await repo.appendUserMessage(conversationId, { text: 'hi', agentId, parentId: null });
    // Pre-splice shape: two prepares as siblings off the user message.
    const a = await repo.appendThoughtPrepareEntry(conversationId, {
      thoughtId: 'thought-a',
      parentId: user.id,
      title: 'A',
    });
    const b = await repo.appendThoughtPrepareEntry(conversationId, {
      thoughtId: 'thought-b',
      parentId: user.id,
      title: 'B',
    });

    const delta = await cursorDeltaAround(() => repo.updateChatEntryParent(conversationId, b.id, a.id));
    expect(delta).toBeGreaterThan(0);
  }, 30_000);

  it('thought-action and assistant-message edits advance the cursor', async () => {
    const conversationId = await createConversation(baseUrl);
    const user = await repo.appendUserMessage(conversationId, { text: 'hi', agentId, parentId: null });

    const action = await repo.appendThoughtActionEntry(conversationId, {
      thoughtId: 'thought-x',
      parentId: user.id,
      status: 'running',
    });
    const actionDelta = await cursorDeltaAround(() =>
      repo.updateThoughtAction(conversationId, action.id, { status: 'completed', summary: 'done' }),
    );
    expect(actionDelta).toBeGreaterThan(0);

    const assistant = await repo.appendAssistantMessage(conversationId, { text: 'draft', parentId: action.id });
    const assistantDelta = await cursorDeltaAround(() =>
      repo.updateAssistantMessage(conversationId, { id: assistant.id, text: 'final' }),
    );
    expect(assistantDelta).toBeGreaterThan(0);
  }, 30_000);
});
