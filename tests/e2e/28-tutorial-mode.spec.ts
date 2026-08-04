import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// Tutorial mode: a spotlight walkthrough over the real screens. The overlay
// dims everything except the step's anchor, navigates to the right route on
// its own, and the library in settings tracks completion for replay.
test("tutorial lesson spotlights the real UI and records completion", async ({ app }) => {
  await app.page.goto("/settings/learn", { waitUntil: "domcontentloaded" });
  const library = app.page.getByTestId("tutorial-library");
  await expect(library).toBeVisible();

  const agentLesson = app.page.locator('[data-testid="tutorial-lesson-row"][data-lesson-id="configure-agent"]');
  await expect(agentLesson).toHaveAttribute("data-completed", "false");
  await agentLesson.getByTestId("tutorial-lesson-start").click();

  // The overlay takes over and navigates to the lesson's route.
  const card = app.page.getByTestId("tutorial-card");
  await expect(card).toBeVisible();
  await expect(app.page).toHaveURL(/\/settings\/agents/);

  // Step 1 spotlights the agent picker: dim panels + ring + instructions.
  await expect(card).toContainText("Agents");
  await expect(app.page.getByTestId("tutorial-step-count")).toHaveText("1 / 4");
  await expect(app.page.getByTestId("tutorial-ring")).toBeVisible();
  await expect(app.page.getByTestId("tutorial-dim").first()).toBeVisible();

  // Walk the lesson.
  await app.page.getByTestId("tutorial-next").click();
  await expect(card).toContainText("Default model");
  await expect(app.page.getByTestId("tutorial-step-count")).toHaveText("2 / 4");
  await app.page.getByTestId("tutorial-next").click();
  await expect(card).toContainText("System prompt");
  await app.page.getByTestId("tutorial-next").click();
  await expect(card).toContainText("Tools & permissions");
  await expect(app.page.getByTestId("tutorial-next")).toHaveText("Done");
  await app.page.getByTestId("tutorial-next").click();
  await expect(card).not.toBeVisible();

  // The library now shows the lesson completed and replayable — and the
  // completion survives a reload (localStorage).
  await app.page.goto("/settings/learn", { waitUntil: "domcontentloaded" });
  await expect(agentLesson).toHaveAttribute("data-completed", "true");
  await expect(agentLesson.getByTestId("tutorial-lesson-start")).toHaveText("Replay");
  await app.page.reload({ waitUntil: "domcontentloaded" });
  await expect(agentLesson).toHaveAttribute("data-completed", "true");
});

// The e2e fixture mutes the tutorial by default (skipped: true), which is also
// the state the "Skip tutorial" button produces — so this test covers both the
// library's re-enable affordance and the skip button restoring the mute.
test("skip tutorial mutes automatic behavior; the library re-enables it", async ({ app }) => {
  await app.page.goto("/settings/learn", { waitUntil: "domcontentloaded" });
  const note = app.page.getByTestId("tutorial-skip-note");
  await expect(note).toBeVisible();
  await app.page.getByTestId("tutorial-reenable").click();
  await expect(note).not.toBeVisible();

  await app.page
    .locator('[data-testid="tutorial-lesson-row"][data-lesson-id="connect-model"]')
    .getByTestId("tutorial-lesson-start")
    .click();
  await expect(app.page.getByTestId("tutorial-card")).toBeVisible();
  await app.page.getByTestId("tutorial-skip").click();
  await expect(app.page.getByTestId("tutorial-overlay")).not.toBeVisible();

  await app.page.goto("/settings/learn", { waitUntil: "domcontentloaded" });
  await expect(note).toBeVisible();
});

test("tutorial navigates to the chat screen and exits on Escape", async ({ app }) => {
  await app.page.goto("/settings/learn", { waitUntil: "domcontentloaded" });
  await app.page
    .locator('[data-testid="tutorial-lesson-row"][data-lesson-id="start-chat"]')
    .getByTestId("tutorial-lesson-start")
    .click();

  await expect(app.page).toHaveURL(/\/chat\/new/);
  const card = app.page.getByTestId("tutorial-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Tool sandbox");
  await expect(app.page.getByTestId("tutorial-ring")).toBeVisible();

  await app.page.keyboard.press("Escape");
  await expect(app.page.getByTestId("tutorial-overlay")).not.toBeVisible();
});
