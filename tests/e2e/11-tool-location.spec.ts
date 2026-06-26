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
