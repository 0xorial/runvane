import { retainSharedTestApp } from '../support/shared-app';
import {
  createConversation,
  getDefaultAgentId,
  INTEGRATION_LLM_TIMEOUT_MS,
  postProbeMessage,
  waitForProbeCompletion,
} from '../support/http';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

type UsageRow = {
  modelName: string;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
};

async function tokenUsageBySingleGet(baseUrl: string, conversationId: string): Promise<UsageRow[]> {
  const res = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}`);
  if (!res.ok) throw new Error(`GET conversation failed: ${res.status}`);
  const row = (await res.json()) as { tokenUsageByModel?: UsageRow[] };
  return row.tokenUsageByModel ?? [];
}

async function tokenUsageByListBatch(baseUrl: string, conversationId: string): Promise<UsageRow[]> {
  const res = await fetch(`${baseUrl}/api/conversations`);
  if (!res.ok) throw new Error(`GET /api/conversations failed: ${res.status}`);
  const body = (await res.json()) as { conversations: Array<{ id: string; tokenUsageByModel?: UsageRow[] }> };
  return body.conversations.find((c) => c.id === conversationId)?.tokenUsageByModel ?? [];
}

// Regression guard for entry-type renames: streamed LLM usage now lives on
// `thought` entries (after `thought_stream_unify` and then `thought_merge`).
// The per-model usage queries filter on the entry type — a stale predicate
// makes a freshly run conversation report an empty tokenUsageByModel, which
// surfaced in the UI as a permanent "set pricing" badge with no model to name
// or locate, even when the model was priced. Both the single-row GET and the
// bulk list path must count the usage.
describeLive('token usage by model after a run (integration)', () => {
  let baseUrl: string;
  let agentId: string;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
    agentId = await getDefaultAgentId(baseUrl);
  }, 30_000);

  it('aggregates thought-entry token usage into tokenUsageByModel', async () => {
    const conversationId = await createConversation(baseUrl);
    await postProbeMessage(baseUrl, conversationId, agentId);
    await waitForProbeCompletion(baseUrl, conversationId);

    const single = await tokenUsageBySingleGet(baseUrl, conversationId);
    expect(single.length).toBeGreaterThan(0);
    for (const row of single) {
      expect(row.modelName.trim().length).toBeGreaterThan(0);
    }
    const totalTokens = single.reduce(
      (sum, r) => sum + r.promptTokens + r.cachedPromptTokens + r.completionTokens,
      0,
    );
    expect(totalTokens).toBeGreaterThan(0);

    // The bulk list query (tokenUsageByModelByIds) must agree with the single GET.
    const batch = await tokenUsageByListBatch(baseUrl, conversationId);
    expect(batch.length).toBe(single.length);
  }, INTEGRATION_LLM_TIMEOUT_MS + 5_000);
});
