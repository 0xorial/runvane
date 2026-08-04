import { defaultAgentId } from "./harness/client";
import { expect, test } from "./fixtures";
import { E2E_LLM_TIMEOUT_MS } from "./timeouts";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// Contextual first-encounter tips: the first time an anchor (here: the todo
// panel) appears, a callout floats next to it; "Got it" retires it for good.
// The fixture mutes tips by default, so this spec seeds live-tip state itself
// (its init script runs after the fixture's absent-only seeding and wins).
test("first todo panel triggers a one-time tip", async ({ app }) => {
  await app.page.addInitScript(() => {
    // Un-mute tips, but ONLY over the fixture's pristine mute — this script
    // re-runs on every navigation, and blindly reseeding would wipe the
    // seen-tip state whose persistence this test asserts.
    const KEY = "runvane.tutorial.v1";
    try {
      const raw = window.localStorage.getItem(KEY);
      const cur = raw ? (JSON.parse(raw) as { skipped?: boolean; seenTips?: object; completed?: object }) : null;
      const pristineMute =
        !cur ||
        (cur.skipped === true &&
          Object.keys(cur.seenTips ?? {}).length === 0 &&
          Object.keys(cur.completed ?? {}).length === 0);
      if (pristineMute) {
        window.localStorage.setItem(KEY, JSON.stringify({ completed: {}, seenTips: {}, skipped: false }));
      }
    } catch {
      /* leave whatever is stored */
    }
  });

  const agentId = await defaultAgentId(app.page.request);
  await app.chat.gotoNew(agentId);
  await app.chat.userInput.typeMessage("__todo_probe__ plan and execute the task");
  await app.chat.userInput.send();

  // The stub records a todo list → the sticky panel appears → the tip fires.
  await expect(app.page.getByTestId("todo-list-panel")).toBeVisible({ timeout: E2E_LLM_TIMEOUT_MS });
  const tip = app.page.getByTestId("tutorial-tip");
  await expect(tip).toBeVisible({ timeout: 5_000 });
  await expect(tip).toHaveAttribute("data-tip-id", "todo-panel");
  await expect(tip).toContainText("Agent to-dos");

  await app.page.getByTestId("tutorial-tip-got-it").click();
  await expect(tip).not.toBeVisible();

  // Seen is persisted: after a reload the panel is still there, the tip is not.
  await app.page.reload({ waitUntil: "domcontentloaded" });
  await expect(app.page.getByTestId("todo-list-panel")).toBeVisible({ timeout: E2E_LLM_TIMEOUT_MS });
  await app.page.waitForTimeout(1_500); // give the scan interval a full cycle
  await expect(app.page.getByTestId("tutorial-tip")).not.toBeVisible();
});
