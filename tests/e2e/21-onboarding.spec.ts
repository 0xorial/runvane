import { apiBaseUrl } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// The setup guide is state-driven: it auto-replaces the agent cards when the
// core chain (verified provider → agent) is broken, and is revisitable via
// ?setup=1. The seeded e2e DB always has a verified stub provider + agents, so
// these tests exercise the forced path with idempotent actions only.

test("setup guide renders on demand, reflects live state, and dismisses", async ({ app }) => {
  await app.page.goto("/chat/new?setup=1", { waitUntil: "domcontentloaded" });
  const guide = app.page.getByTestId("setup-guide");
  await expect(guide).toBeVisible();

  // Seeded state: stub provider verified, agents exist — both steps done.
  await expect(app.page.getByTestId("setup-provider-done")).toBeVisible();
  await expect(app.page.getByTestId("setup-agent-done")).toBeVisible();

  // Provider rows come from the settings document; the stub row shows its
  // verified model count and stays expandable (done ≠ locked).
  const stubRow = app.page.locator('[data-testid="setup-provider-row"][data-provider-id="stub"]');
  await expect(stubRow).toBeVisible();
  await stubRow.locator("button").first().click();
  const testButton = app.page.getByTestId("setup-provider-test");
  await expect(testButton).toBeVisible();

  // Re-testing a verified provider round-trips and keeps the step done.
  const testRequest = app.page.waitForResponse(
    (res) => res.url().includes("/llm_provider/test_connection") && res.request().method() === "POST",
  );
  await testButton.click();
  expect((await testRequest).ok()).toBe(true);
  await expect(app.page.getByTestId("setup-provider-done")).toBeVisible();

  // Dismiss returns to the agent cards (the guide was forced, chain is fine).
  await app.page.getByTestId("setup-dismiss").click();
  await expect(guide).not.toBeVisible();
  expect(app.page.url()).not.toContain("setup=1");
});

test("setup guide creates a configured agent in one step", async ({ app, request }) => {
  await app.page.goto("/chat/new?setup=1", { waitUntil: "domcontentloaded" });
  await expect(app.page.getByTestId("setup-guide")).toBeVisible();

  const name = `Onboarding e2e agent ${Date.now()}`;
  await app.page.getByTestId("setup-agent-name").fill(name);
  // The model picker lists verified providers' models; stub is always there.
  const modelValue = await app.page.getByTestId("setup-agent-model").inputValue();
  expect(modelValue.startsWith("stub ")).toBe(true);

  await app.page.getByTestId("setup-agent-create").click();

  // Creation lands on the agent cards with the new agent selected.
  await expect(app.page.getByTestId("setup-guide")).not.toBeVisible();
  const listRes = await request.get(`${apiBaseUrl()}/api/agents`);
  expect(listRes.ok()).toBeTruthy();
  const agents = (await listRes.json()) as Array<{
    id: string;
    name: string;
    is_default: boolean;
    default_llm_configuration: { provider_id?: string; model_name?: string } | null;
  }>;
  const agent = agents.find((row) => row.name === name);
  expect(agent).toBeTruthy();
  const createdId = agent!.id;
  // The URL must select the agent that was just created — not get "corrected"
  // back to an older agent by a stale toolbar list.
  await expect(app.page).toHaveURL(new RegExp(`agent=${createdId}`));
  expect(agent!.default_llm_configuration?.provider_id).toBe("stub");
  // Agents already existed, so the new one must not steal the default flag.
  expect(agent!.is_default).toBe(false);

  // Restore shared state for the rest of the suite.
  const del = await request.delete(`${apiBaseUrl()}/api/agents/${encodeURIComponent(createdId)}`);
  expect(del.ok()).toBeTruthy();
});

test("settings overview shows live counts and navigates the grouped sections", async ({ app }) => {
  await app.page.goto("/settings/overview", { waitUntil: "domcontentloaded" });
  await expect(app.page.getByTestId("settings-overview")).toBeVisible();

  // Live counts off the seeded state: the stub provider is the only one and
  // it is verified; agents exist — so the chain is complete, no banner.
  await expect(app.page.getByTestId("overview-card-model-providers")).toContainText("1 of 1 connected");
  await expect(app.page.getByTestId("overview-card-agents")).toContainText("configured");
  await expect(app.page.getByTestId("overview-setup-banner")).not.toBeVisible();

  // Concept cards navigate within settings (slugs unchanged by the regroup).
  await app.page.getByTestId("overview-card-tool-sandboxes").click();
  await expect(app.page).toHaveURL(/\/settings\/tool-sandboxes/);
  await expect(app.page.getByTestId("tool-sandboxes-section")).toBeVisible();
});

test("knowledge create form flags an unconnected embedding provider", async ({ app }) => {
  await app.page.goto("/settings/knowledge", { waitUntil: "domcontentloaded" });
  // Open the create form if another test's storages left it collapsed.
  const addButton = app.page.getByTestId("knowledge-add");
  if (await addButton.isVisible().catch(() => false)) await addButton.click();

  // The form defaults to provider id "openai", which the e2e backend has no
  // verified models for — the dead-end hint names it and links Providers.
  await expect(app.page.getByTestId("knowledge-provider")).toHaveValue("openai");
  await expect(app.page.getByTestId("knowledge-no-models-hint")).toBeVisible();
  await expect(app.page.getByTestId("knowledge-no-models-hint")).toContainText("openai");

  // Switching to the connected stub provider clears the hint.
  await app.page.getByTestId("knowledge-provider").fill("stub");
  await expect(app.page.getByTestId("knowledge-no-models-hint")).not.toBeVisible();
});
