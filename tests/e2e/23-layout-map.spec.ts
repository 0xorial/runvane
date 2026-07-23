import { apiBaseUrl, defaultAgentId } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// The new-chat layout map: a live diagram of where the pieces of the
// conversation being configured run. It must follow the same selection state
// the cards edit — sandbox switches move the tool-host between the machine and
// the sandbox box, None drops it entirely.

test("layout map follows the sandbox selection", async ({ app, page, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  const map = page.getByTestId("layout-map");
  await expect(map).toBeVisible();
  await expect(map.getByTestId("layout-map-machine")).toBeVisible();
  await expect(map.getByTestId("layout-map-harness")).toBeVisible();

  // Default sandbox is the Harness host: the tool-host renders inside the
  // machine and there is no separate sandbox box.
  await expect(map.getByTestId("layout-map-toolhost")).toBeVisible();
  await expect(map.getByTestId("layout-map-sandbox")).toHaveCount(0);

  // None: the tool-host disappears, the map notes the missing sandbox.
  await page.locator('[data-testid="tool-env-card"][data-env-id="none"]').click();
  await expect(map.getByTestId("layout-map-toolhost")).toHaveCount(0);
  await expect(map.getByText(/no sandbox/)).toBeVisible();
});

test("layout map draws an ssh sandbox as a separate box", async ({ app, page, request }) => {
  // A plain ssh sandbox is config-only — no container needs to exist for the
  // map to draw where the tool-host WOULD run.
  const created = await request.post(`${apiBaseUrl()}/api/tool-sandboxes`, {
    data: { name: "e2e-map-box", ssh: { host: "map.e2e.invalid" } },
  });
  expect(created.ok()).toBeTruthy();
  const env = (await created.json()) as { id: string };

  try {
    const agentId = await defaultAgentId(request);
    await app.chat.gotoNew(agentId);
    await page.locator(`[data-testid="tool-env-card"][data-env-id="${env.id}"]`).click();

    const map = page.getByTestId("layout-map");
    const box = map.getByTestId("layout-map-sandbox");
    await expect(box).toBeVisible();
    // The tool-host moves into the sandbox box; the machine's copy fades out,
    // so wait for the crossfade to settle before asserting on the survivor.
    await expect(map.getByTestId("layout-map-toolhost")).toHaveCount(1);
    await expect(map.getByTestId("layout-map-toolhost")).toBeVisible();
    await expect(map.getByText("e2e-map-box")).toBeVisible();
    await expect(map.getByText("ssh", { exact: true })).toBeVisible();
    await expect(map.getByText("map.e2e.invalid")).toBeVisible();
  } finally {
    await request.delete(`${apiBaseUrl()}/api/tool-sandboxes/${encodeURIComponent(env.id)}`);
  }
});
