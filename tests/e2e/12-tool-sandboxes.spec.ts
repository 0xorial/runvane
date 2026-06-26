import { apiBaseUrl, defaultAgentId, USER_MSG_HELLO } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

type EnvRow = { id: string; name: string };

async function listSandboxes(request: import("@playwright/test").APIRequestContext): Promise<EnvRow[]> {
  const res = await request.get(`${apiBaseUrl()}/api/tool-sandboxes`);
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { sandboxes: EnvRow[] }).sandboxes;
}

test("new-chat env cards render and bind the sandbox to the conversation", async ({ app, page, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  const localCard = page.locator('[data-testid="tool-env-card"][data-env-id="local"]');
  const noneCard = page.locator('[data-testid="tool-env-card"][data-env-id="none"]');
  await expect(localCard).toBeVisible();
  await expect(noneCard).toBeVisible();
  // Local is selected by default and carries the same-host explainer.
  await expect(localCard).toHaveAttribute("aria-pressed", "true");
  await expect(localCard).toContainText(/same host/i);

  // Select None — persists to the URL and flips the selected card.
  await noneCard.click();
  await expect(page).toHaveURL(/env=none/);
  await expect(noneCard).toHaveAttribute("aria-pressed", "true");

  // Sending the first message creates the conversation bound to that env.
  await app.chat.userInput.typeMessage(USER_MSG_HELLO);
  await app.chat.userInput.send();
  await page.waitForURL((url) => {
    const id = url.pathname.match(/\/chat\/([^/?#]+)/)?.[1];
    return id != null && id !== "new";
  });
  const conversationId = app.chat.conversationIdFromUrl();

  const res = await request.get(`${apiBaseUrl()}/api/conversations/${encodeURIComponent(conversationId)}`);
  expect(res.ok()).toBeTruthy();
  const conversation = (await res.json()) as { toolSandboxId: string | null };
  expect(conversation.toolSandboxId).toBe("none");

  // The chat header surfaces the bound sandbox next to the title.
  const headerBadge = page.getByTestId("chat-tool-env");
  await expect(headerBadge).toBeVisible();
  await expect(headerBadge).toHaveAttribute("data-env-id", "none");
  await expect(headerBadge).toContainText("None");
});

test("add-sandbox card opens a dialog that creates and selects a new ssh env", async ({ app, page, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  await page.getByTestId("tool-env-add").click();
  const dialog = page.getByTestId("add-env-dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByTestId("add-env-name").fill("E2E Box");
  await dialog.getByPlaceholder("box.local").fill("e2e.local");
  await dialog.getByTestId("add-env-submit").click();

  // Dialog closes; the new env shows up as a card and is auto-selected.
  await expect(dialog).toBeHidden();
  const newCard = page.locator('[data-testid="tool-env-card"]', { hasText: "E2E Box" });
  await expect(newCard).toBeVisible();
  await expect(newCard).toContainText(/e2e\.local/);
  await expect(newCard).toHaveAttribute("aria-pressed", "true");

  // Cleanup so the run stays idempotent.
  const created = (await listSandboxes(request)).find((e) => e.name === "E2E Box");
  if (created) {
    const del = await request.delete(`${apiBaseUrl()}/api/tool-sandboxes/${encodeURIComponent(created.id)}`);
    expect(del.ok()).toBeTruthy();
  }
});

test("settings Tool Sandboxes section creates and deletes an ssh env", async ({ page }) => {
  await page.goto("/settings/tool-sandboxes", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tool-sandboxes-section")).toBeVisible();

  await page.getByTestId("tool-env-name").fill("E2E Settings Box");
  await page.getByTestId("tool-env-host").fill("settings.e2e.local");
  await page.getByTestId("tool-env-create").click();

  const row = page.locator('[data-testid="tool-env-row"]', { hasText: "E2E Settings Box" });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/settings\.e2e\.local/);

  await row.getByTestId("tool-env-delete").click();
  await expect(row).toBeHidden();
});
