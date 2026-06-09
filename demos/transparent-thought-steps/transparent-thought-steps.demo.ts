import { defaultAgentId, PROBE_MESSAGE } from "../../tests/e2e/harness/client";
import { stubLlmConfigure, stubLlmReset, type StubModelScript } from "../../tests/e2e/harness/stub-llm";
import { E2E_LLM_TIMEOUT_MS } from "../../tests/e2e/timeouts";
import { beat, expect, test } from "../_shared/demo-test";
import { demoClick, demoKeyOnly, demoTypeOnly, installDemoOverlay } from "../_shared/overlay";
import { plannerReply, plannerToolCall } from "../_shared/planner";
import { streamMsPerToken } from "../_shared/stub-timing";

const MODEL = "gpt-4o";
const QUICK_TYPE_MS = 6;
const TITLE_MS = 200;
const PARAMS_MS = 300;
const TOOL_ROUND_MS = 1200;
const FINAL_PLANNER_MS = 600;
const TOOL_PARAMS = "{}";

const TITLE = "Time inquiry";
const TOOL_ROUND = plannerToolCall(
  "Let me check the current time.",
  "get_current_time",
  "current server time",
  "User asked for the time; call get_current_time.",
);
const FINAL_REPLY = "The current time is 12:00 UTC.";
const FINAL_PLANNER = plannerReply(FINAL_REPLY, "Tool returned the current time.");

const STUB_SCRIPT: StubModelScript[] = [
  {
    responses: [
      { text: TITLE, streamMs: streamMsPerToken(TITLE, TITLE_MS) },
      { text: TOOL_PARAMS, streamMs: streamMsPerToken(TOOL_PARAMS, PARAMS_MS) },
    ],
  },
  {
    model: MODEL,
    responses: [
      { text: TOOL_ROUND, streamMs: streamMsPerToken(TOOL_ROUND, TOOL_ROUND_MS) },
      { text: FINAL_PLANNER, streamMs: streamMsPerToken(FINAL_PLANNER, FINAL_PLANNER_MS) },
    ],
  },
];

test("transparent-thought-steps", async ({ app, request }) => {
  await stubLlmReset(request);
  await stubLlmConfigure(request, STUB_SCRIPT);

  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  const composer = app.chat.userInput.textarea;
  await demoClick(app.page, composer);
  await demoTypeOnly(composer, PROBE_MESSAGE, QUICK_TYPE_MS);
  await demoKeyOnly(app.page, "Shift+Enter");

  await app.chat.transcript.waitForProbeComplete(E2E_LLM_TIMEOUT_MS);
  await beat(500);

  await demoClick(app.page, app.chat.transcript.prepareRow("Title generation").getByTestId("thought-step-context"));
  await expect(app.chat.transcript.prepareRow("Title generation").getByTestId("thought-step-panel")).toBeVisible();
  await beat(700);

  const plan0 = app.chat.transcript.prepareRow("Decision planning", 0);
  await demoClick(app.page, plan0.getByTestId("thought-step-context"));
  await beat(600);
  await demoClick(app.page, plan0.getByTestId("thought-step-reasoning"));
  await expect(plan0.getByText("Raw response")).toBeVisible();
  await beat(700);

  const params = app.chat.transcript.prepareRow("Resolve tool parameters");
  await demoClick(app.page, params.getByTestId("thought-step-reasoning"));
  await beat(700);

  const plan1 = app.chat.transcript.prepareRow("Decision planning", 1);
  await demoClick(app.page, plan1.getByTestId("thought-step-reasoning"));
  await expect(plan1.getByText("Raw response")).toBeVisible();
  await beat(1200);
});
