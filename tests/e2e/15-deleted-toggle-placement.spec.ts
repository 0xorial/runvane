import { createConversation, defaultAgentId } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("recent-conversations side panel omits the deleted toggle; the All-conversations page keeps it", async ({
  app,
  request,
}) => {
  const agentId = await defaultAgentId(request);
  // Need at least one conversation so both the sidebar and the full list render.
  const conversationId = await createConversation(request, `e2e deleted-toggle ${Date.now()}`);
  const toggle = app.page.getByTestId("conversations-toggle-deleted");

  // Sidebar (chat route): the recent-conversations side panel must not show it.
  await app.chat.gotoNew(agentId);
  await expect(app.sidebar.conversationButton(conversationId)).toBeVisible();
  await expect(toggle).toHaveCount(0);

  // Full "All conversations" page: the toggle stays available and still works.
  await app.page.goto("/conversations", { waitUntil: "domcontentloaded" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText("Show deleted");
  await toggle.click();
  await expect(toggle).toHaveText("Show active");
});
