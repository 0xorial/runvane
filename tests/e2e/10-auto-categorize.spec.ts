import {
  createProbeConversation,
  defaultAgentId,
  getConversation,
  listConversations,
  moveConversationToGroup,
  setConversationConfig,
  setConversationGroupPinned,
} from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// The stub LLM returns this for any categorization request (see stubLlm.helpers).
const STUB_CATEGORY = "Coding";

async function groupNameOf(
  request: Parameters<typeof getConversation>[0],
  conversationId: string,
): Promise<string | null> {
  const conv = await getConversation(request, conversationId);
  if (!conv.groupId) return null;
  const { groups } = await listConversations(request);
  return groups.find((g) => g.id === conv.groupId)?.name ?? null;
}

test("auto-categorizes a new conversation into a group after its first message", async ({ request }) => {
  test.setTimeout(20_000);
  await setConversationConfig(request, { enabled: true });

  const agentId = await defaultAgentId(request);
  const conversationId = await createProbeConversation(request, agentId);

  await expect
    .poll(() => groupNameOf(request, conversationId), { timeout: 15_000 })
    .toBe(STUB_CATEGORY);

  const conv = await getConversation(request, conversationId);
  expect(conv.groupPinned ?? false).toBe(false);
});

test("manual move pins the chat; unlocking re-categorizes it", async ({ request }) => {
  test.setTimeout(25_000);
  await setConversationConfig(request, { enabled: true });

  const agentId = await defaultAgentId(request);
  const conversationId = await createProbeConversation(request, agentId);

  // Wait for the initial auto-categorization to land.
  await expect
    .poll(() => groupNameOf(request, conversationId), { timeout: 15_000 })
    .toBe(STUB_CATEGORY);

  // A manual move pins the chat so the categorizer leaves it alone.
  const manualGroup = `e2e manual ${Date.now()}`;
  await moveConversationToGroup(request, conversationId, { newGroupName: manualGroup });
  const pinned = await getConversation(request, conversationId);
  expect(pinned.groupPinned).toBe(true);
  expect(await groupNameOf(request, conversationId)).toBe(manualGroup);

  // Unlocking frees it and re-runs categorization, moving it back.
  await setConversationGroupPinned(request, conversationId, false);
  await expect
    .poll(async () => (await getConversation(request, conversationId)).groupPinned ?? false, { timeout: 5_000 })
    .toBe(false);
  await expect
    .poll(() => groupNameOf(request, conversationId), { timeout: 15_000 })
    .toBe(STUB_CATEGORY);

  // Leave categorization off so it can't perturb later runs.
  await setConversationConfig(request, { enabled: false });
});
