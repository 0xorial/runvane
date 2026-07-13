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
 * is lost on the client. (Historically the ChatChain reparent/splice was the
 * mutation that bit us; reparenting is gone — entries state their causal
 * parent at insert — so the remaining mutations are payload updates.)
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

  it('tool-invocation state updates advance the cursor', async () => {
    const conversationId = await createConversation(baseUrl);
    const user = await repo.appendUserMessage(conversationId, { text: 'hi', agentId, parentId: null });
    const tool = await repo.appendToolInvocation(conversationId, {
      toolId: 'mock_tool_1',
      state: 'resolving',
      parameters: { tool_request: 'probe' },
      parentId: user.id,
    });

    const delta = await cursorDeltaAround(() =>
      repo.updateToolInvocation(conversationId, { id: tool.id, state: 'running', parameters: { probe: 1 } }),
    );
    expect(delta).toBeGreaterThan(0);
  }, 30_000);

  it('thought and assistant-message edits advance the cursor', async () => {
    const conversationId = await createConversation(baseUrl);
    const user = await repo.appendUserMessage(conversationId, { text: 'hi', agentId, parentId: null });

    const thought = await repo.appendThoughtEntry(conversationId, {
      thoughtType: 'planner',
      parentId: user.id,
      stage: 'decide',
      status: 'running',
    });
    const thoughtDelta = await cursorDeltaAround(() =>
      repo.updateThoughtDecision(conversationId, thought.id, { status: 'completed', summary: 'done' }),
    );
    expect(thoughtDelta).toBeGreaterThan(0);

    const assistant = await repo.appendAssistantMessage(conversationId, { text: 'draft', parentId: thought.id });
    const assistantDelta = await cursorDeltaAround(() =>
      repo.updateAssistantMessage(conversationId, { id: assistant.id, text: 'final' }),
    );
    expect(assistantDelta).toBeGreaterThan(0);
  }, 30_000);
});
