import { defaultAgentId } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// The stub planner records a 3-item to-do list (one completed, one in_progress,
// one pending) via `todo_write`, then finalizes. That call must (1) surface as a
// compact transcript row and (2) drive the sticky to-do panel above the composer.
test("todo_write renders the to-do panel and a compact transcript row", async ({ app }) => {
  const agentId = await defaultAgentId(app.page.request);
  await app.chat.gotoNew(agentId);
  await app.chat.userInput.typeMessage("__todo_probe__ plan and execute the task");
  await app.chat.userInput.send();

  // Planner finalizes only after the list is recorded.
  await expect(app.chat.transcript.assistantMessage).toContainText("worked through the steps", {
    timeout: 20_000,
  });

  // Compact transcript row summarizes the write (1 of 3 completed) — not a full
  // tool row.
  const todoRow = app.chat.transcript.container.getByTestId("todo-write-row");
  await expect(todoRow).toBeVisible();
  await expect(todoRow).toContainText("Updated to-dos");
  await expect(todoRow).toContainText("1/3 done");

  // Sticky panel above the composer shows the derived current list.
  const panel = app.page.getByTestId("todo-list-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("To-dos");
  await expect(panel).toContainText("1/3 done");

  const items = panel.getByTestId("todo-list-items").locator("li");
  await expect(items).toHaveCount(3);
  // The in_progress item shows its present-continuous activeForm; a completed
  // item shows its content.
  await expect(panel.locator('li[data-status="in_progress"]')).toContainText("Implementing the feature");
  await expect(panel.locator('li[data-status="completed"]')).toContainText("Explore the codebase");
});
