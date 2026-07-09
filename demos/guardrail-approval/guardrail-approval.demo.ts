import { GUARDED_AGENT_ID, PROBE_MESSAGE } from "../../tests/e2e/harness/client";
import { stubLlmConfigure, stubLlmReset, type StubModelScript } from "../../tests/e2e/harness/stub-llm";
import { E2E_LLM_TIMEOUT_MS } from "../../tests/e2e/timeouts";
import { beat, expect, test } from "../_shared/demo-test";
import { demoClick, demoKeyOnly, demoTypeOnly, installDemoOverlay } from "../_shared/overlay";
import { plannerReply, plannerToolCall } from "../_shared/planner";
import { streamMsPerToken } from "../_shared/stub-timing";

const MODEL = "stub";
const QUICK_TYPE_MS = 6;
const TITLE_MS = 200;
const PARAMS_MS = 300;
const GUARDRAIL_MS = 350;
const TOOL_ROUND_MS = 1200;
const FINAL_PLANNER_MS = 600;
const TOOL_PARAMS = "{}";

const TITLE = "Time inquiry";
const GUARDRAIL_REASON = "Agent policy requires human review before tools run in this environment.";
const GUARDRAIL_REPLY = JSON.stringify({ verdict: "flag", reason: GUARDRAIL_REASON });
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
      { text: GUARDRAIL_REPLY, streamMs: streamMsPerToken(GUARDRAIL_REPLY, GUARDRAIL_MS) },
      { text: FINAL_PLANNER, streamMs: streamMsPerToken(FINAL_PLANNER, FINAL_PLANNER_MS) },
    ],
  },
];

test("guardrail-approval", async ({ app, request }) => {
  await stubLlmReset(request);
  await stubLlmConfigure(request, STUB_SCRIPT);

  await installDemoOverlay(app.page);
  await app.chat.gotoNew(GUARDED_AGENT_ID);

  const composer = app.chat.userInput.textarea;
  await demoClick(app.page, composer);
  await demoTypeOnly(composer, PROBE_MESSAGE, QUICK_TYPE_MS);
  await demoKeyOnly(app.page, "Shift+Enter");

  await app.chat.transcript.waitForToolState("requested", 0, E2E_LLM_TIMEOUT_MS);
  const tool = app.chat.transcript.toolRow();
  await expect(tool).toContainText("Guardrail flagged");
  await expect(tool).toContainText(GUARDRAIL_REASON);
  await beat(700);

  await demoClick(app.page, tool.getByTestId("tool-approve-button"));
  await app.chat.transcript.waitForToolState("done", 0, E2E_LLM_TIMEOUT_MS);
  await app.chat.transcript.waitForAssistantMessageCount(2, E2E_LLM_TIMEOUT_MS);
  await app.chat.transcript.expectTranscriptContains(FINAL_REPLY);
  await beat(1500);
});
