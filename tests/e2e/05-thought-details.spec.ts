import { defaultAgentId } from "./harness/client";
import { expect, test } from "./fixtures";
import { E2E_LLM_TIMEOUT_MS } from "./timeouts";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("collapsed thought rows open their stage details in the right panel", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();

  await app.chat.transcript.openThoughtDetails("Title generation");
  await app.chat.transcript.expectThoughtPanel("context");
  await expect(app.chat.transcript.detailPanel.getByText("model:").first()).toBeVisible();

  await app.chat.transcript.openThoughtDetails("Decision planning", 0);
  await app.chat.transcript.expectThoughtPanel("reasoning");
  await expect(app.chat.transcript.detailPanel.getByText("Raw response")).toBeVisible();
});

test("reprocess reasoning from the details panel", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();

  await app.chat.transcript.openThoughtDetails("Decision planning", 0);
  const panel = app.chat.transcript.detailPanel;
  await panel.getByTestId("thought-reprocess-edit").click();
  await expect(panel.getByTestId("thought-reprocess-apply")).toBeVisible();

  const reprocessDone = app.page.waitForResponse(
    (res) => res.url().includes("/reprocess-reason") && res.status() === 202,
  );
  await panel.getByTestId("thought-reprocess-apply").click();
  await reprocessDone;

  await expect(panel.getByTestId("thought-reprocess-apply")).toBeHidden({ timeout: E2E_LLM_TIMEOUT_MS });
  await expect(panel.getByTestId("thought-reprocess-edit")).toBeVisible();
  await expect(panel.getByText("Raw response")).toBeVisible();
});
