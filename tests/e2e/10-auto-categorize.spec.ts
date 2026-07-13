import {
  createConversation,
  createProbeConversation,
  defaultAgentId,
  getConversation,
  getConversationEntries,
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

// Categorization is gated on having at least one group to sort into. Create one
// so these specs pass even against a freshly-seeded (group-less) database. Use a
// title-only conversation (no message → no LLM run) and just move it into a new
// group, so the bootstrap adds no DB-write contention with the spec's real run.
async function ensureAGroupExists(request: Parameters<typeof createConversation>[0]): Promise<void> {
  const bootstrapConv = await createConversation(request, "e2e group anchor");
  await moveConversationToGroup(request, bootstrapConv, { newGroupName: `existing ${Date.now()}` });
}

test("auto-categorizes a new conversation into an existing group", async ({ request }) => {
  test.setTimeout(25_000);
  await setConversationConfig(request, { enabled: true });
  const agentId = await defaultAgentId(request);

  // Categorization only runs once at least one group exists to sort into.
  await ensureAGroupExists(request);

  const conversationId = await createProbeConversation(request, agentId);

  await expect
    .poll(() => groupNameOf(request, conversationId), { timeout: 15_000 })
    .toBe(STUB_CATEGORY);

  const conv = await getConversation(request, conversationId);
  expect(conv.groupPinned ?? false).toBe(false);

  // Categorization is a first-class thought now (not a hidden side-channel
  // call): it leaves a persisted, inspectable thought stream on the chain. The
  // categorize thought runs concurrently with the probe and persists its entries
  // independently of the group write, so the entry can land just after the group
  // becomes visible — poll for it rather than reading entries once (avoids a race
  // under load).
  await expect
    .poll(
      async () => {
        const entries = await getConversationEntries(request, conversationId);
        return entries.some(
          (e) => e.type === "thought" && e.thoughtType === "categorize" && e.title === "Categorize conversation",
        );
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("manual move pins the chat; unlocking re-categorizes it", async ({ request }) => {
  test.setTimeout(30_000);
  await setConversationConfig(request, { enabled: true });

  const agentId = await defaultAgentId(request);

  // Categorization needs an existing group to sort into.
  await ensureAGroupExists(request);

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

test("conversations page renders with search and a toggleable categorization panel", async ({ app }) => {
  await app.page.goto("/conversations", { waitUntil: "domcontentloaded" });

  await expect(app.page.getByRole("heading", { name: "Conversations" })).toBeVisible();
  await expect(app.page.getByTestId("conversations-search")).toBeVisible();

  const panelText = app.page.getByText("Auto-categorize new conversations");
  await expect(panelText).toBeHidden();
  await app.page.getByTestId("conversations-settings-toggle").click();
  await expect(panelText).toBeVisible();
});
