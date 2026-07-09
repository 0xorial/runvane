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

// The agent settings tool table shows the same location badge per tool, so
// where a tool executes is visible while configuring it — not only after a
// run. `curl` lives in the tool-host (target); the probe tool is harness.
test("agent settings tool list shows harness/target badges", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.page.goto(`/settings/agents?agent=${encodeURIComponent(agentId)}`, {
    waitUntil: "domcontentloaded",
  });

  const rowFor = (tool: string) =>
    app.page.locator("tr").filter({ has: app.page.locator(`code:text-is("${tool}")`) });

  const probeBadge = rowFor("get_current_time").getByTestId("settings-tool-location");
  await expect(probeBadge).toBeVisible();
  await expect(probeBadge).toHaveAttribute("data-tool-location", "harness");

  const curlBadge = rowFor("curl").getByTestId("settings-tool-location");
  await expect(curlBadge).toBeVisible();
  await expect(curlBadge).toHaveAttribute("data-tool-location", "target");
});
