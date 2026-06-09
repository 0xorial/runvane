import { defaultAgentId } from "../../e2e/api/client";
import { stubLlmConfigure, stubLlmReset } from "../../e2e/api/stub-llm";
import { E2E_LLM_TIMEOUT_MS } from "../../e2e/timeouts";
import { beat, expect, test } from "../_shared/demo-test";
import { demoClick, demoKeyOn, demoTypeInto, installDemoOverlay } from "../_shared/overlay";
import { plannerReply } from "../_shared/planner";

const MODEL = "gpt-4o";
const MINI = "gpt-4o-mini";
const STREAM_MS = 20;

const PROMPT = "What's the most underrated skill for a software engineer?";
const TITLE = "Underrated engineering skills";

const GPT4O_MARKDOWN = `**Reading code you didn't write.** Most engineers optimize for *writing* code, but you spend far more time understanding unfamiliar systems — debugging, reviewing, onboarding. People who can quickly build an accurate mental model of someone else's code ship fixes faster and break less. It compounds: every system you can read is one you can safely change.`;

const MINI_MARKDOWN = `**Writing clearly.** The bottleneck on most teams isn't typing speed — it's communication. A crisp PR description or a two-line message that prevents an hour-long meeting is pure leverage. Clear writing also forces clear thinking, so it makes the *code* better too.`;

test("multi-model-compare", async ({ app, request }) => {
  await stubLlmReset(request);
  await stubLlmConfigure(request, [
    { responses: [{ text: TITLE }] },
    {
      model: MODEL,
      responses: [
        { text: plannerReply(GPT4O_MARKDOWN, "Pick the single most leveraged skill."), streamMs: STREAM_MS },
      ],
    },
    {
      model: MINI,
      responses: [
        { text: plannerReply(MINI_MARKDOWN, "Pick the single most leveraged skill."), streamMs: STREAM_MS },
      ],
    },
  ]);

  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  await demoTypeInto(app.chat.userInput.textarea, PROMPT, 10);
  await demoKeyOn(app.page, app.chat.userInput.textarea, "Shift+Enter");
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await beat(300);

  const row = app.chat.transcript.prepareRow("Decision planning", 0);
  await demoClick(app.page, row.getByTestId("thought-prepare-try-model"));
  const listbox = app.page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const reprocessDone = app.page.waitForResponse(
    (res) => res.url().includes("/reprocess-context") && res.status() === 202,
  );
  await demoClick(app.page, listbox.getByRole("button", { name: MINI, exact: true }));
  await reprocessDone;
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await expect(row.getByTestId("branch-selector")).toBeVisible({ timeout: E2E_LLM_TIMEOUT_MS });

  const sel = row.getByTestId("branch-selector");
  const prev = sel.getByRole("button", { name: /previous/i });
  if (await prev.count()) {
    await demoClick(app.page, prev);
    await beat(300);
    const next = sel.getByRole("button", { name: /next/i });
    if (await next.count()) await demoClick(app.page, next);
  }
  await beat(300);
});
