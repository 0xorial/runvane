import { defaultAgentId } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// A tool row shows where the tool ran (brain vs sandbox), derived from the
// catalog `location`. The probe tool (get-current-time) runs centrally, so its
// row is tagged "brain"; runtime tools (bash, tool-host tools) tag "sandbox".
test("tool row shows a brain/sandbox location badge", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();
  await app.chat.transcript.waitForToolState("done");

  const badge = app.chat.transcript.toolRow().getByTestId("tool-location");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("data-tool-location", "brain");
  await expect(badge).toHaveText(/brain/i);
});
