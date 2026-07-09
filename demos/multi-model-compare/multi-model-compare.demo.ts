import { defaultAgentId } from "../../tests/e2e/harness/client";
import { stubLlmConfigure, stubLlmReset, type StubModelScript } from "../../tests/e2e/harness/stub-llm";
import { E2E_LLM_TIMEOUT_MS } from "../../tests/e2e/timeouts";
import { beat, expect, test } from "../_shared/demo-test";
import { demoClick, demoKeyOnly, demoTypeOnly, installDemoOverlay } from "../_shared/overlay";
import { plannerReply } from "../_shared/planner";
import { streamMsPerToken } from "../_shared/stub-timing";

const MODEL = "gpt-4o";
const MINI = "gpt-4o-mini";
const QUICK_TYPE_MS = 6;
const TITLE_MS = 200;
const PLANNER_MS = 700;

const PROMPT = "What's the most underrated skill for a software engineer?";
const TITLE = "Underrated engineering skills";

const GPT4O_MARKDOWN = `**Reading code you didn't write.** Most engineers optimize for *writing* code, but you spend far more time understanding unfamiliar systems — debugging, reviewing, onboarding. People who can quickly build an accurate mental model of someone else's code ship fixes faster and break less. It compounds: every system you can read is one you can safely change.`;

const MINI_MARKDOWN = `**Writing clearly.** The bottleneck on most teams isn't typing speed — it's communication. A crisp PR description or a two-line message that prevents an hour-long meeting is pure leverage. Clear writing also forces clear thinking, so it makes the *code* better too.`;

const GPT4O_PLANNER = plannerReply(GPT4O_MARKDOWN, "Pick the single most leveraged skill.");
const MINI_PLANNER = plannerReply(MINI_MARKDOWN, "Pick the single most leveraged skill.");

const STUB_SCRIPT: StubModelScript[] = [
  { responses: [{ text: TITLE, streamMs: streamMsPerToken(TITLE, TITLE_MS) }] },
  {
    model: MODEL,
    responses: [{ text: GPT4O_PLANNER, streamMs: streamMsPerToken(GPT4O_PLANNER, PLANNER_MS) }],
  },
  {
    model: MINI,
    responses: [{ text: MINI_PLANNER, streamMs: streamMsPerToken(MINI_PLANNER, PLANNER_MS) }],
  },
];

test("multi-model-compare", async ({ app, request }) => {
  await stubLlmReset(request);
  await stubLlmConfigure(request, STUB_SCRIPT);

  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  const composer = app.chat.userInput.textarea;
  await demoClick(app.page, composer);
  await demoTypeOnly(composer, PROMPT, QUICK_TYPE_MS);
  await demoKeyOnly(app.page, "Shift+Enter");

  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await beat(900);

  // Try-model lives in the details panel now — open it from the collapsed row.
  const row = app.chat.transcript.prepareRow("Decision planning", 0);
  await demoClick(app.page, row.getByTestId("thought-collapsed-row"));
  const tryModel = app.chat.transcript.detailPanel.getByTestId("thought-prepare-try-model");
  await expect(tryModel).toBeVisible();
  await beat(600);
  await demoClick(app.page, tryModel);
  const listbox = app.page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const reprocessDone = app.page.waitForResponse(
    (res) => res.url().includes("/reprocess-context") && res.status() === 202,
  );
  await demoClick(app.page, listbox.getByRole("button", { name: MINI, exact: true }));
  await reprocessDone;
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await expect(row.getByTestId("branch-selector")).toBeVisible({ timeout: E2E_LLM_TIMEOUT_MS });
  await beat(600);

  const sel = row.getByTestId("branch-selector");
  const prev = sel.getByRole("button", { name: /previous/i });
  if (await prev.count()) {
    await demoClick(app.page, prev);
    await beat(700);
    const next = sel.getByRole("button", { name: /next/i });
    if (await next.count()) await demoClick(app.page, next);
  }
  await beat(1500);
});
