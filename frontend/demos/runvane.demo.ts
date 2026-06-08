// Demo flows, driven by scripts/record-demos.mjs against a SIMULATED LLM (the
// stub in LLM_DEMO mode: rich, prompt-aware content streamed slowly). Keyboard-
// driven so the on-screen keystroke HUD shows the shortcuts (⇧↵ send, ⌘↵ steer).
// Waits are on real UI state; deterministic, free, no API.
import { test, expect } from "../e2e/fixtures";
import { defaultAgentId } from "../e2e/api/client";
import { installDemoOverlay } from "./overlay";
import type { Locator, Page } from "@playwright/test";

const beat = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const LLM = 120_000;
const SECOND_MODEL = /gpt-4o-mini/i;

async function typeInto(loc: Locator, text: string, delay = 36): Promise<void> {
  await loc.click();
  await loc.pressSequentially(text, { delay });
}
const send = (page: Page) => page.keyboard.press("Shift+Enter");
const steer = (page: Page) => page.keyboard.press("Meta+Enter");

// 1. Multi-model compare — one question, answered by gpt-4o, then re-answered
//    by a second model on its own branch you can flip between.
test("multi-model-compare", async ({ app, request }) => {
  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  await typeInto(
    app.chat.userInput.textarea,
    "In one punchy sentence: what's the most underrated skill for a software engineer, and why?",
  );
  await beat(400);
  await send(app.page);
  await app.chat.transcript.waitForAssistantReply(LLM);
  await beat(2500);

  const row = app.chat.transcript.prepareRow("Decision planning", 0);
  const tryModel = row.getByTestId("thought-prepare-try-model");
  await tryModel.scrollIntoViewIfNeeded();
  await tryModel.click();
  const search = app.page.getByPlaceholder("Search model");
  await expect(search).toBeVisible();
  await typeInto(search, "gpt-4o-mini", 45);
  await beat(700);
  await app.page.getByRole("button", { name: SECOND_MODEL }).first().click();

  await expect(row.getByTestId("branch-selector")).toBeVisible({ timeout: LLM });
  await app.chat.transcript.waitForAssistantReply(LLM);
  await beat(2500);

  const sel = row.getByTestId("branch-selector");
  const prev = sel.getByRole("button", { name: /previous/i });
  if (await prev.count()) {
    await prev.click();
    await beat(2500);
    const next = sel.getByRole("button", { name: /next/i });
    if (await next.count()) await next.click();
  }
  await beat(2500);
});

// 2. Steering — interrupt a long answer mid-stream with ⌘↵ and redirect.
test("steering", async ({ app, request }) => {
  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  await typeInto(
    app.chat.userInput.textarea,
    "Write an extremely detailed, comprehensive ~1500-word guide to configuring a production Nginx reverse proxy: TLS, HTTP/2, caching, rate limiting, and security headers, with config snippets and explanations for every section.",
  );
  await beat(400);
  await send(app.page);

  const steerBtn = app.page.getByTestId("chat-steer-button");
  await expect(steerBtn).toBeVisible({ timeout: LLM });
  await beat(1600); // let it visibly stream, then cut in fast

  await typeInto(
    app.chat.userInput.textarea,
    "Actually — stop. Just give me the 3 essential commands, nothing else.",
    26,
  );
  await beat(300);
  await steer(app.page); // ⌘↵ for the HUD
  await beat(450);
  // Fallback in case the long answer finished before the keypress landed.
  if (await steerBtn.isVisible().catch(() => false)) await steerBtn.click();

  await app.chat.transcript.waitForUserMessageCount(2, LLM);
  await app.chat.transcript.waitForAssistantReply(LLM);
  await beat(3000);
});

// 3. Transparent runtime — open a thought step to inspect the exact context
//    and reasoning behind the model's decision.
test("transparent-runtime", async ({ app, request }) => {
  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  await typeInto(app.chat.userInput.textarea, "Briefly: how does TLS 1.3 improve on TLS 1.2?");
  await beat(400);
  await send(app.page);
  await app.chat.transcript.waitForAssistantReply(LLM);
  await beat(1500);

  await app.chat.transcript.expandThoughtStep("Decision planning", "context", 0);
  await beat(2800);
  await app.chat.transcript.expandThoughtStep("Decision planning", "reasoning", 0);
  await beat(3200);
});
