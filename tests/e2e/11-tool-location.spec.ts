import { defaultAgentId } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// A tool row shows where the tool ran (harness vs target), derived from the
// catalog `location`. The probe tool (get-current-time) runs centrally, so its
// row is tagged "harness"; target tools (bash, tool-host tools) tag "target".
test("tool row shows a harness/target location badge", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();
  await app.chat.transcript.waitForToolState("done");

  const badge = app.chat.transcript.toolRow().getByTestId("tool-location");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("data-tool-location", "harness");
  await expect(badge).toHaveText(/harness/i);
});

// The agent settings tool table is split by execution location, so where a
// tool runs is visible while configuring it — not only after a run. `curl`
// lives in the tool-host (target section); the probe tool is harness.
test("agent settings groups tools into harness and target sections", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.page.goto(`/settings/agents?agent=${encodeURIComponent(agentId)}`, {
    waitUntil: "domcontentloaded",
  });

  const harness = app.page.getByTestId("tool-section-harness");
  const target = app.page.getByTestId("tool-section-target");
  await expect(harness.getByText("Harness tools")).toBeVisible();
  await expect(target.getByText("Target sandbox tools")).toBeVisible();

  await expect(harness.locator('code:text-is("get_current_time")')).toBeVisible();
  await expect(target.locator('code:text-is("curl")')).toBeVisible();
  await expect(target.locator('code:text-is("get_current_time")')).toHaveCount(0);
  await expect(harness.locator('code:text-is("curl")')).toHaveCount(0);
});
