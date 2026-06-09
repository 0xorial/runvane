import { defaultAgentId, STUB_SUMMARIZE_REPLY } from "../../tests/e2e/harness/client";
import { stubLlmConfigure, stubLlmReset, type StubModelScript } from "../../tests/e2e/harness/stub-llm";
import { E2E_LLM_TIMEOUT_MS } from "../../tests/e2e/timeouts";
import { beat, expect, test } from "../_shared/demo-test";
import { demoClick, demoKeyOnly, demoTypeOnly, installDemoOverlay } from "../_shared/overlay";
import { plannerReply } from "../_shared/planner";
import { streamMsPerToken } from "../_shared/stub-timing";

const MODEL = "gpt-4o";
const QUICK_TYPE_MS = 6;
const TITLE_MS = 200;
const PLANNER_MS = 550;

const MSG_ONE = "Outline three ways to cut API latency.";
const MSG_TWO = "Add a fourth option focused on edge caching.";
const TITLE = "API latency options";

const REPLY_ONE = plannerReply(
  "1. **Connection pooling** — reuse HTTP/2 connections.\n2. **Payload slimming** — trim fields and compress.\n3. **Regional routing** — serve from the nearest POP.",
  "List three concrete latency wins.",
);
const REPLY_TWO = plannerReply(
  "4. **Edge caching** — cache idempotent GETs at CDN edges with short TTLs and cache keys scoped per tenant.",
  "Add the caching angle the user asked for.",
);

const STUB_SCRIPT: StubModelScript[] = [
  { responses: [{ text: TITLE, streamMs: streamMsPerToken(TITLE, TITLE_MS) }] },
  {
    model: MODEL,
    responses: [
      { text: REPLY_ONE, streamMs: streamMsPerToken(REPLY_ONE, PLANNER_MS) },
      { text: REPLY_TWO, streamMs: streamMsPerToken(REPLY_TWO, PLANNER_MS) },
    ],
  },
];

test("summarize-fold", async ({ app, request }) => {
  await stubLlmReset(request);
  await stubLlmConfigure(request, STUB_SCRIPT);

  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  const composer = app.chat.userInput.textarea;

  await demoClick(app.page, composer);
  await demoTypeOnly(composer, MSG_ONE, QUICK_TYPE_MS);
  await demoKeyOnly(app.page, "Shift+Enter");
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await beat(400);

  await demoClick(app.page, composer);
  await demoTypeOnly(composer, MSG_TWO, QUICK_TYPE_MS);
  await demoKeyOnly(app.page, "Shift+Enter");
  await app.chat.transcript.waitForUserMessageCount(2, E2E_LLM_TIMEOUT_MS);
  await app.chat.transcript.waitForAssistantMessageCount(2, E2E_LLM_TIMEOUT_MS);
  await beat(500);

  const foldRow = app.chat.transcript.userMessageRow(1);
  await demoClick(app.page, foldRow.getByTestId("fold-from-here"));
  await app.chat.transcript.waitForCheckpointSummary(STUB_SUMMARIZE_REPLY, E2E_LLM_TIMEOUT_MS);
  await app.chat.transcript.expectTranscriptContains(MSG_ONE);
  await app.chat.transcript.expectTranscriptNotContains(MSG_TWO);
  await beat(1500);
});
