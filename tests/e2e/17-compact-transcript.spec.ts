import { defaultAgentId, GUARDED_AGENT_ID, PROBE_MESSAGE } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("finished tool collapses to a dimmed one-liner with elapsed time; details open in the right panel", async ({
  app,
  request,
}) => {
  await app.chat.gotoNew(await defaultAgentId(request));
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();
  await app.chat.transcript.waitForToolState("done");

  const tool = app.chat.transcript.toolRow();
  await expect(tool).toHaveAttribute("data-collapsed", "true");
  // The collapsed line keeps name + timing + timestamp but no expanded body.
  await expect(tool).toContainText("Done");
  await expect(tool).toContainText(/\d+(\.\d+)?(ms|s)/);
  await expect(tool).toContainText("just now");
  await expect(tool).not.toContainText("Arguments");

  await tool.click();
  const panel = app.chat.transcript.detailPanel;
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Arguments");
  await expect(panel).toContainText("Result");

  // Clicking the selected row again closes the details and Activity returns.
  await tool.click();
  await expect(panel).toHaveCount(0);
  await expect(app.page.getByRole("heading", { name: "Activity" })).toBeVisible();
});

test("finished thought collapses to one line and opens all stage details", async ({ app, request }) => {
  await app.chat.gotoNew(await defaultAgentId(request));
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();

  const row = app.chat.transcript.prepareRow("Decision planning", 0);
  await expect(row.getByTestId("thought-collapsed-row")).toBeVisible();
  await expect(row.getByTestId("thought-collapsed-row")).toContainText("just now");
  await expect(row.getByTestId("thought-step-context")).toHaveCount(0);

  await app.chat.transcript.openThoughtDetails("Decision planning", 0);
  for (const stage of ["context", "reasoning", "action"] as const) {
    await app.chat.transcript.expectThoughtPanel(stage);
  }
  await app.chat.transcript.detailPanel.getByTestId("entry-detail-close").click();
  await expect(app.chat.transcript.detailPanel).toHaveCount(0);
});

test("a pending tool keeps the full card; collapsing happens only once terminal", async ({ app }) => {
  await app.chat.gotoNew(GUARDED_AGENT_ID);
  await app.chat.userInput.typeMessage(PROBE_MESSAGE);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForToolState("requested");

  const tool = app.chat.transcript.toolRow();
  await expect(tool).not.toHaveAttribute("data-collapsed", "true");
  await expect(tool.getByTestId("tool-approve-button")).toBeVisible();
  await expect(tool).toContainText("Arguments");

  await tool.getByTestId("tool-approve-button").click();
  await app.chat.transcript.waitForToolState("done");
  await expect(tool).toHaveAttribute("data-collapsed", "true");
  await expect(tool.getByTestId("tool-approve-button")).toHaveCount(0);
});

test("long detail texts clamp to a dimmed preview with expand/collapse", async ({ app, request }) => {
  await app.chat.gotoNew(await defaultAgentId(request));
  // A long user message lands verbatim in the planner prompt, making the
  // details-panel Prompt section tall enough to trigger the clamp.
  await app.chat.userInput.typeMessage(`clamp probe ${"lorem ipsum dolor sit amet ".repeat(150)}`);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();

  await app.chat.transcript.openThoughtDetails("Decision planning", 0);
  const context = app.chat.transcript.detailPanel.locator('[data-thought-stage="context"]');
  const clip = context.getByTestId("block-clip").first();
  const expand = context.getByTestId("block-expand").first();
  await expect(expand).toBeVisible();
  const clamped = await clip.boundingBox();
  expect(clamped!.height).toBeLessThanOrEqual(160);

  await expand.click();
  await expect(context.getByTestId("block-expand")).toHaveCount(0);
  const collapse = context.getByTestId("block-collapse");
  await expect(collapse).toBeVisible();
  const full = await clip.boundingBox();
  expect(full!.height).toBeGreaterThan(300);

  // Scroll into the middle of the expanded block: the collapse chip is sticky,
  // so it must stay inside the visible panel instead of sitting at the block's
  // far end.
  await app.chat.transcript.detailPanel.locator(".overflow-y-auto").first().evaluate((el) => {
    el.scrollTop = 200;
  });
  const chipBox = await collapse.boundingBox();
  const viewport = app.page.viewportSize()!;
  expect(chipBox!.y).toBeGreaterThan(0);
  expect(chipBox!.y).toBeLessThan(viewport.height);

  await collapse.click();
  await expect(context.getByTestId("block-expand").first()).toBeVisible();
});

test("clicking a collapsed row opens the right panel even when it was hidden", async ({ app, request }) => {
  await app.chat.gotoNew(await defaultAgentId(request));
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();
  await app.chat.transcript.waitForToolState("done");

  // Hide the right sidebar, then open details from a collapsed row.
  await app.page.locator('button[title="Hide activity"]').click();
  await expect(app.page.getByRole("heading", { name: "Activity" })).toHaveCount(0);

  await app.chat.transcript.toolRow().click();
  await expect(app.chat.transcript.detailPanel).toBeVisible();
});
