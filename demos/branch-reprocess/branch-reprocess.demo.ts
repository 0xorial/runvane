import { defaultAgentId } from "../../tests/e2e/harness/client";
import { stubLlmConfigure, stubLlmReset, type StubModelScript } from "../../tests/e2e/harness/stub-llm";
import { E2E_LLM_TIMEOUT_MS } from "../../tests/e2e/timeouts";
import { beat, expect, test } from "../_shared/demo-test";
import { demoClick, demoKeyOnly, demoTypeOnly, installDemoOverlay } from "../_shared/overlay";
import { plannerReply } from "../_shared/planner";
import { streamMsPerToken } from "../_shared/stub-timing";

const MODEL = "gpt-4o";
const QUICK_TYPE_MS = 6;
const TITLE_MS = 200;
const PLANNER_MS = 600;

const USER_MSG = "Explain eventual consistency in one paragraph.";
const EDITED_MSG = "Explain eventual consistency in two short bullet points.";
const TITLE = "Eventual consistency";

const REPLY_LINEAR = plannerReply(
  "Eventual consistency means replicas may temporarily disagree, but given no new writes they converge to the same value — common in distributed databases tuned for availability.",
  "One concise paragraph.",
);
const REPLY_BRANCH = plannerReply(
  "- **Idea:** replicas may diverge briefly, then converge when writes stop.\n- **Trade-off:** higher availability and partition tolerance vs strong read-your-writes.",
  "User asked for bullets instead.",
);

const STUB_SCRIPT: StubModelScript[] = [
  { responses: [{ text: TITLE, streamMs: streamMsPerToken(TITLE, TITLE_MS) }] },
  {
    model: MODEL,
    responses: [
      { text: REPLY_LINEAR, streamMs: streamMsPerToken(REPLY_LINEAR, PLANNER_MS) },
      { text: REPLY_BRANCH, streamMs: streamMsPerToken(REPLY_BRANCH, PLANNER_MS) },
    ],
  },
];

test("branch-reprocess", async ({ app, request }) => {
  await stubLlmReset(request);
  await stubLlmConfigure(request, STUB_SCRIPT);

  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  const composer = app.chat.userInput.textarea;
  await demoClick(app.page, composer);
  await demoTypeOnly(composer, USER_MSG, QUICK_TYPE_MS);
  await demoKeyOnly(app.page, "Shift+Enter");
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await app.chat.transcript.expectNoBranchSelectors();
  await beat(600);

  const row = app.chat.transcript.userMessageRow();
  await demoClick(app.page, row.getByTestId("user-message-edit"));
  const area = row.locator("textarea");
  await demoClick(app.page, area);
  await area.fill(EDITED_MSG);

  const reprocessDone = app.page.waitForResponse(
    (res) => res.url().includes("/reprocess") && res.status() === 202,
  );
  await demoClick(app.page, row.getByTestId("user-message-reprocess"));
  await reprocessDone;

  await app.chat.transcript.waitForBranchSelectors(1, E2E_LLM_TIMEOUT_MS);
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await expect(row.getByTestId("branch-selector")).toBeVisible();
  await beat(1500);
});
