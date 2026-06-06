import { defaultAgentId } from "./api/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("sidebar probe shows expected transcript sequence", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.sidebar.runProbeTime();
  await app.chat.transcript.expectProbeSequence();
});

test("probe transcript unchanged after page refresh", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.sidebar.runProbeTime();
  const before = await app.chat.transcript.expectProbeSequence();

  await app.page.reload({ waitUntil: "domcontentloaded" });
  const after = await app.chat.transcript.expectProbeSequence();
  expect(after).toEqual(before);
});
