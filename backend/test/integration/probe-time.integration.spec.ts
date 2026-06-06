import { INestApplication } from '@nestjs/common';
import { SseType } from '../../src/contracts/sse';
import { createTestApp, type TestApp } from '../support/bootstrap-app';
import {
  assertProbeShape,
  createConversation,
  entryTypesInOrder,
  getConversation,
  getDefaultAgentId,
  INTEGRATION_LLM_TIMEOUT_MS,
  postProbeMessage,
  setDefaultViewLeaf,
  waitForProbeCompletion,
} from '../support/http';
import { collectSseDuring } from '../support/sse-client';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

describeLive('probe time (integration)', () => {
  let testApp: TestApp;
  let app: INestApplication;
  let baseUrl: string;
  let agentId: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
    baseUrl = testApp.baseUrl;
    agentId = await getDefaultAgentId(baseUrl);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('completes probe message with expected entry shape', async () => {
    const conversationId = await createConversation(baseUrl);
    await postProbeMessage(baseUrl, conversationId, agentId);
    const entries = await waitForProbeCompletion(baseUrl, conversationId);
    assertProbeShape(entryTypesInOrder(entries));
  }, INTEGRATION_LLM_TIMEOUT_MS + 15_000);

  it('streams SSE upserts during probe', async () => {
    const conversationId = await createConversation(baseUrl);
    const { result: entries, events } = await collectSseDuring(baseUrl, conversationId, async () => {
      await postProbeMessage(baseUrl, conversationId, agentId);
      return waitForProbeCompletion(baseUrl, conversationId);
    });

    assertProbeShape(entryTypesInOrder(entries));
    expect(events.filter((ev) => ev.type === SseType.CHAT_ENTRY_UPSERT).length).toBeGreaterThan(0);
    expect(events.some((ev) => ev.type === SseType.USER_MESSAGE)).toBe(true);

    const conversation = await getConversation(baseUrl, conversationId);
    expect(conversation.defaultViewLeafEntryId).toBeTruthy();
  }, INTEGRATION_LLM_TIMEOUT_MS + 15_000);

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
  }, INTEGRATION_LLM_TIMEOUT_MS + 15_000);
});
