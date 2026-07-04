import { retainSharedTestApp } from '../support/shared-app';
import {
  createConversation,
  getConversation,
  getDefaultAgentId,
  listAllMessages,
  pollUntil,
  postConversationMessage,
} from '../support/http';
import type { StubLlmControl } from '../../../backend/src/llmProviders/providers/stubLlm.control';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

// The seeded default agent runs provider "stub", model "stub" (not the
// `STUB_E2E_MODELS` name — that's only what `listModels()` advertises to the
// model picker). Target scripted responses at the actual model in use.
const STUB_MODEL = 'stub';

type ConversationCostRow = {
  providerCostTotal: number;
  providerCostPartial: boolean;
};

async function getConversationCost(baseUrl: string, conversationId: string): Promise<ConversationCostRow> {
  const res = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}`);
  if (!res.ok) throw new Error(`GET conversation failed: ${res.status}`);
  const row = (await res.json()) as Partial<ConversationCostRow>;
  if (typeof row.providerCostTotal !== 'number' || typeof row.providerCostPartial !== 'boolean') {
    throw new Error('GET conversation: missing providerCostTotal/providerCostPartial');
  }
  return { providerCostTotal: row.providerCostTotal, providerCostPartial: row.providerCostPartial };
}

/** A single-round, no-tool-call planner reply in the JSON shape the planner expects. */
function finalPlannerReply(assistantOutput: string): string {
  return JSON.stringify({
    assistant_thinking: 'Answering directly, no tool needed.',
    assistant_output: assistantOutput,
    tool_requests: [],
    followup: 'finalize',
  });
}

async function waitForFinalAssistantMessage(baseUrl: string, conversationId: string, text: string): Promise<void> {
  await pollUntil(async () => {
    const entries = await listAllMessages(baseUrl, conversationId);
    return entries.some((e) => e.type === 'assistant-message' && e.text === text) || null;
  }, `assistant message "${text}"`);
}

// Regression guard for the OpenRouter-style "provider reports cost directly in
// the response" path: a turn whose usage carries `costUsd` (parsed from e.g.
// OpenRouter's `usage.cost`) must roll up into the conversation's
// `providerCostTotal`, and a turn from a provider that DOESN'T report cost must
// flip `providerCostPartial` so the total is known to be a lower bound rather
// than silently passing as exact.
//
// A real message also triggers background stub calls outside this test's
// control (auto-title on the first message, possibly auto-categorization) that
// never carry a cost. Rather than fight that noise, assertions here are
// delta-based: only a turn this test explicitly scripts a cost for should move
// providerCostTotal, regardless of what else is going on concurrently.
describeLive('conversation provider cost aggregation (integration)', () => {
  let baseUrl: string;
  let agentId: string;
  let stubLlm: StubLlmControl;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
    agentId = await getDefaultAgentId(baseUrl);
    if (!testApp.stubLlm) throw new Error('integration setup: stub LLM not available (INTEGRATION_LIVE_LLM=1?)');
    stubLlm = testApp.stubLlm;
  }, 30_000);

  it('accumulates provider-reported cost and flags the total partial once a turn omits it', async () => {
    const conversationId = await createConversation(baseUrl);
    const before = await getConversationCost(baseUrl, conversationId);
    expect(before.providerCostTotal).toBe(0);

    // Turn 1: provider reports cost directly (e.g. OpenRouter's usage.cost).
    stubLlm.configure([{ model: STUB_MODEL, responses: [{ text: finalPlannerReply('first answer'), costUsd: 0.01234 }] }]);
    await postConversationMessage(baseUrl, conversationId, agentId, 'first question');
    await waitForFinalAssistantMessage(baseUrl, conversationId, 'first answer');

    const afterFirst = await getConversationCost(baseUrl, conversationId);
    expect(afterFirst.providerCostTotal).toBeCloseTo(before.providerCostTotal + 0.01234, 8);

    // Turn 2: provider doesn't report cost (the common case) — the total must
    // stay exactly what turn 1 contributed (this turn adds nothing), but the
    // conversation is now known to be a lower bound rather than exact.
    const leaf = await getConversation(baseUrl, conversationId);
    stubLlm.configure([{ model: STUB_MODEL, responses: [{ text: finalPlannerReply('second answer') }] }]);
    await postConversationMessage(baseUrl, conversationId, agentId, 'second question', {
      parentId: leaf.defaultViewLeafEntryId,
    });
    await waitForFinalAssistantMessage(baseUrl, conversationId, 'second answer');

    const afterSecond = await getConversationCost(baseUrl, conversationId);
    expect(afterSecond.providerCostTotal).toBeCloseTo(afterFirst.providerCostTotal, 8);
    expect(afterSecond.providerCostPartial).toBe(true);

    // Per-model rollup (feeds the cost popover): the stub model's row carries
    // the reported sum, and is flagged incomplete because turn 2 reported
    // nothing — the UI must show the reported amount, never "set price".
    const row = (
      (await getConversation(baseUrl, conversationId)) as unknown as {
        tokenUsageByModel: Array<{ modelName: string; providerCostUsd: number | null; providerCostComplete: boolean }>;
      }
    ).tokenUsageByModel.find((r) => r.modelName === STUB_MODEL);
    expect(row).toBeDefined();
    expect(row!.providerCostUsd).toBeCloseTo(0.01234, 8);
    expect(row!.providerCostComplete).toBe(false);
  }, 15_000);
});
