import path from "node:path";
import { defaultAgentId } from "../../tests/e2e/harness/client";
import { stubLlmConfigure, stubLlmReset, type StubModelScript } from "../../tests/e2e/harness/stub-llm";
import { E2E_LLM_TIMEOUT_MS } from "../../tests/e2e/timeouts";
import { beat, expect, test } from "../_shared/demo-test";
import { demoClick, demoKeyOnly, demoTypeOnly, installDemoOverlay } from "../_shared/overlay";
import { plannerReply } from "../_shared/planner";
import { streamMsPerToken } from "../_shared/stub-timing";

const brandHero = path.join(process.cwd(), "e2e/fixtures/runvane-brand-hero.png");

const MODEL = "gpt-4o";
const QUICK_TYPE_MS = 6;
const TITLE_MS = 200;
const SUMMARY_MS = 900;
const PLANNER_MS = 600;

const MSG_ONE = "Describe this brand asset.";
const MSG_TWO = "What exact palette and mood does the full image suggest for a developer tool?";

const TITLE = "Brand asset review";
const IMAGE_SUMMARY =
  "Stacked isometric rounded squares on black. Top layer: white wireframe outline. " +
  "Bottom layer: solid purple crystalline block with glowing streak texture. " +
  "Thin dashed connectors link the corners — reads as layered product/stack imagery.";

const REPLY_ONE = plannerReply(
  "It is a stacked brand mark: a wireframe square floating above a glowing purple block, " +
    "connected by dashed guides. The composition suggests layers, structure, and depth.",
  "User attached a hero image; summarize-attachment already distilled the visual.",
);

const STUB_SCRIPT: StubModelScript[] = [
  { responses: [{ text: TITLE, streamMs: streamMsPerToken(TITLE, TITLE_MS) }] },
  {
    model: MODEL,
    responses: [
      { text: IMAGE_SUMMARY, streamMs: streamMsPerToken(IMAGE_SUMMARY, SUMMARY_MS) },
      { text: REPLY_ONE, streamMs: streamMsPerToken(REPLY_ONE, PLANNER_MS) },
    ],
  },
];

test("attachment-summary", async ({ app, request }) => {
  await stubLlmReset(request);
  await stubLlmConfigure(request, STUB_SCRIPT);

  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  await demoClick(app.page, app.chat.userInput.attachButton);
  await app.page.locator('footer input[type="file"]').setInputFiles(brandHero);
  await beat(900);

  await demoClick(app.page, app.page.getByRole("radio", { name: "Summary" }));
  await beat(500);

  const composer = app.chat.userInput.textarea;
  await demoClick(app.page, composer);
  await demoTypeOnly(composer, MSG_ONE, QUICK_TYPE_MS);
  await demoKeyOnly(app.page, "Shift+Enter");

  await app.chat.transcript.waitForPrepareTitle("Summarize attachment", E2E_LLM_TIMEOUT_MS);
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await beat(400);

  const summarize = app.chat.transcript.prepareRow("Summarize attachment");
  await demoClick(app.page, summarize.getByTestId("thought-step-reasoning"));
  await expect(summarize).toContainText("purple crystalline");
  await beat(700);

  await demoClick(app.page, composer);
  await demoTypeOnly(composer, MSG_TWO, QUICK_TYPE_MS);
  await demoKeyOnly(app.page, "Shift+Enter");

  await app.chat.transcript.waitForUserMessageCount(2, E2E_LLM_TIMEOUT_MS);
  await app.chat.transcript.waitForToolState("done", 0, E2E_LLM_TIMEOUT_MS);
  const askTool = app.chat.transcript.toolRow(0);
  await expect(askTool).toContainText("ask_attachment");
  await askTool.scrollIntoViewIfNeeded();
  await beat(400);
  await demoClick(app.page, askTool.getByRole("button", { expanded: false }));
  await expect(askTool).toContainText("deep violet");
  await beat(1400);

  await expect(app.chat.transcript.container).toContainText("Cool violet", { timeout: E2E_LLM_TIMEOUT_MS });
  await beat(1200);
});
