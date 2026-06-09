import { SseType, type SseEvent } from '../../../backend/src/contracts/sse';
import { retainSharedTestApp } from '../support/shared-app';
import {
  assertProbeParentChain,
  assertProbeShape,
  assertProbeToolInvocation,
  createConversation,
  entryTypesInOrder,
  getConversation,
  getDefaultAgentId,
  INTEGRATION_LLM_TIMEOUT_MS,
  postProbeMessage,
  setDefaultViewLeaf,
  waitForProbeCompletion,
  walkParentChain,
  type ChatEntryRow,
} from '../support/http';
import { collectSseDuring } from '../support/sse-client';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

describeLive('probe time (integration)', () => {
  let baseUrl: string;
  let agentId: string;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
    agentId = await getDefaultAgentId(baseUrl);
  }, 30_000);

  it('completes probe message with expected entry shape', async () => {
    const conversationId = await createConversation(baseUrl);
    await postProbeMessage(baseUrl, conversationId, agentId);
    const entries = await waitForProbeCompletion(baseUrl, conversationId);
    assertProbeShape(entryTypesInOrder(entries));
    assertProbeToolInvocation(entries);
    const conversation = await getConversation(baseUrl, conversationId);
    if (!conversation.defaultViewLeafEntryId) {
      throw new Error('probe: missing defaultViewLeafEntryId');
    }
    assertProbeParentChain(entries, conversation.defaultViewLeafEntryId);
  }, INTEGRATION_LLM_TIMEOUT_MS + 5_000);

  it('streams SSE upserts during probe', async () => {
    const conversationId = await createConversation(baseUrl);
    const { result: entries, events } = await collectSseDuring(baseUrl, conversationId, async () => {
      await postProbeMessage(baseUrl, conversationId, agentId);
      return waitForProbeCompletion(baseUrl, conversationId);
    });

    assertProbeShape(entryTypesInOrder(entries));
    assertProbeToolInvocation(entries);
    expect(events.filter((ev) => ev.type === SseType.CHAT_ENTRY_UPSERT).length).toBeGreaterThan(0);
    expect(events.some((ev) => ev.type === SseType.USER_MESSAGE)).toBe(true);

    const viewUpdates = events.filter((ev) => ev.type === SseType.CONVERSATION_UPDATED);
    expect(viewUpdates.length).toBeGreaterThan(0);
    const withAnchor = viewUpdates.filter(
      (ev) => ev.type === SseType.CONVERSATION_UPDATED && ev.conversation.defaultViewLeafAnchorId,
    );
    expect(withAnchor.length).toBeGreaterThan(0);

    const conversation = await getConversation(baseUrl, conversationId);
    expect(conversation.defaultViewLeafEntryId).toBeTruthy();
    assertProbeParentChain(entries, conversation.defaultViewLeafEntryId!);
    assertSseParentChainMatchesHttp(events, entries, conversation.defaultViewLeafEntryId!);
  }, INTEGRATION_LLM_TIMEOUT_MS + 5_000);

  it('default-view-leaf can be repointed to user-message anchor', async () => {
    const conversationId = await createConversation(baseUrl);
    await postProbeMessage(baseUrl, conversationId, agentId);
    const entries = await waitForProbeCompletion(baseUrl, conversationId);
    const user = entries.find((entry) => entry.type === 'user-message');
    if (!user) throw new Error('probe: missing user-message');

    const resolvedTip = await setDefaultViewLeaf(baseUrl, conversationId, user.id);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const path: typeof entries = [];
    let cursor: string | null = resolvedTip;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const row = byId.get(cursor);
      if (!row) throw new Error(`probe: unknown entry ${cursor} on default-view path`);
      path.unshift(row);
      cursor = row.parentId;
    }

    expect(path[0]?.id).toBe(user.id);
    expect(path.some((entry) => entry.type === 'assistant-message')).toBe(true);
  }, INTEGRATION_LLM_TIMEOUT_MS + 5_000);
});

function applySseUpserts(events: SseEvent[]): Map<string, ChatEntryRow> {
  const map = new Map<string, ChatEntryRow>();
  for (const ev of events) {
    if (ev.type === SseType.USER_MESSAGE || ev.type === SseType.CHAT_ENTRY_UPSERT) {
      const entry = ev.entry;
      map.set(entry.id, {
        id: entry.id,
        type: entry.type,
        conversationIndex: entry.conversationIndex,
        parentId: entry.parentId ?? null,
        text: 'text' in entry ? String(entry.text ?? '') : undefined,
        title: 'title' in entry ? entry.title : undefined,
      });
    }
  }
  return map;
}

/** SSE-reconstructed parent pointers must match HTTP for every entry that was upserted. */
function assertSseParentChainMatchesHttp(
  events: SseEvent[],
  httpEntries: ChatEntryRow[],
  tipId: string,
): void {
  const sseById = applySseUpserts(events);
  for (const entry of walkParentChain(httpEntries, tipId)) {
    const sseEntry = sseById.get(entry.id);
    if (!sseEntry) continue;
    if (sseEntry.parentId !== entry.parentId) {
      throw new Error(
        `probe SSE: entry ${entry.id} (${entry.type}) parentId=${sseEntry.parentId}, HTTP has ${entry.parentId}`,
      );
    }
  }
  const user = httpEntries.find((row) => row.type === 'user-message');
  const titlePrepare = httpEntries.find(
    (row) => row.type === 'thought-prepare' && row.title === 'Title generation',
  );
  if (!user || !titlePrepare) throw new Error('probe SSE: missing user or title prepare in HTTP snapshot');
  const sseTitle = sseById.get(titlePrepare.id);
  if (!sseTitle) throw new Error('probe SSE: missing title prepare upsert');
  if (sseTitle.parentId !== user.id) {
    throw new Error(`probe SSE: title prepare parentId=${sseTitle.parentId}, expected user ${user.id}`);
  }
  if (titlePrepare.parentId !== user.id) {
    throw new Error(`probe HTTP: title prepare parentId=${titlePrepare.parentId}, expected user ${user.id}`);
  }
  if (sseTitle.parentId !== titlePrepare.parentId) {
    throw new Error('probe SSE: title prepare parentId diverged from HTTP after stream');
  }
}
