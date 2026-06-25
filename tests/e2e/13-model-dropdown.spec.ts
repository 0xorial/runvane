import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// Reproduces: opening a populated model dropdown and clicking an item does
// nothing (the selection never registers). Seed provides the verified `stub`
// provider exposing `stub-model`.
test("system settings: selecting a reasoning model updates the dropdown", async ({ app }) => {
  await app.page.goto("/settings/system", { waitUntil: "domcontentloaded" });
  await expect(app.page.getByText("Global model settings")).toBeVisible();

  const reasoningColumn = app.page.locator("div.bg-card.p-4").filter({ hasText: "Reasoning model" });
  const trigger = reasoningColumn.getByRole("button").first();
  await trigger.click();

  const listbox = app.page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await listbox.getByRole("button", { name: "stub-model" }).click();

  await expect(trigger).toContainText("stub-model");
});
