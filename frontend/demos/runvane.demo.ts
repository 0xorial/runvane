// Demo flows, driven by scripts/record-demos.mjs against a SIMULATED LLM (the
// stub in LLM_DEMO mode: rich, prompt-aware content streamed slowly). Keyboard-
// driven so the on-screen keystroke HUD shows the shortcuts (⇧↵ send, ⌘↵ steer).
import { test, expect } from "../e2e/fixtures";
import { apiBaseUrl, defaultAgentId } from "../e2e/api/client";
import { E2E_LLM_TIMEOUT_MS } from "../e2e/timeouts";
import { installDemoOverlay } from "./overlay";
import type { Locator, Page } from "@playwright/test";

const beat = (ms = 300) => new Promise((r) => setTimeout(r, ms));

async function typeInto(loc: Locator, text: string, delay = 14): Promise<void> {
  await loc.click();
  await loc.pressSequentially(text, { delay });
}
const send = (page: Page) => page.keyboard.press("Shift+Enter");
const steer = (page: Page) => page.keyboard.press("Meta+Enter");

test.beforeEach(async ({ request }) => {
  const res = await request.get(`${apiBaseUrl()}/health`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { llmMode?: string };
  expect(body.llmMode, "demo harness must use stub LLM — run `npm run demos`").toBe("stub");
});

test("multi-model-compare", async ({ app, request }) => {
  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  await typeInto(
    app.chat.userInput.textarea,
    "What's the most underrated skill for a software engineer?",
    10,
  );
  await send(app.page);
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await beat(300);

  const row = app.chat.transcript.prepareRow("Decision planning", 0);
  await row.getByTestId("thought-prepare-try-model").click();
  const listbox = app.page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const reprocessDone = app.page.waitForResponse(
    (res) => res.url().includes("/reprocess-context") && res.status() === 202,
  );
  await listbox.getByRole("button", { name: "gpt-4o-mini", exact: true }).click();
  await reprocessDone;
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await expect(row.getByTestId("branch-selector")).toBeVisible({ timeout: E2E_LLM_TIMEOUT_MS });

  const sel = row.getByTestId("branch-selector");
  const prev = sel.getByRole("button", { name: /previous/i });
  if (await prev.count()) {
    await prev.click();
    await beat(300);
    const next = sel.getByRole("button", { name: /next/i });
    if (await next.count()) await next.click();
  }
  await beat(300);
});

test("steering", async ({ app, request }) => {
  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  await app.chat.userInput.textarea.fill(
    "Give me a detailed nginx reverse proxy guide: TLS, HTTP/2, caching, rate limiting, and security headers.",
  );
  await send(app.page);

  const steerBtn = app.page.getByTestId("chat-steer-button");
  await expect(steerBtn).toBeVisible({ timeout: E2E_LLM_TIMEOUT_MS });
  await typeInto(
    app.chat.userInput.textarea,
    "Actually — stop. Just give me the 3 essential commands, nothing else.",
    14,
  );
  await steerBtn.click();

  await app.chat.transcript.waitForUserMessageCount(2, E2E_LLM_TIMEOUT_MS);
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await app.chat.transcript.expectTranscriptContains("nginx -t");
  await beat(600);
});

test("transparent-runtime", async ({ app, request }) => {
  await installDemoOverlay(app.page);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  await typeInto(app.chat.userInput.textarea, "Briefly: how does TLS 1.3 improve on TLS 1.2?");
  await send(app.page);
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);
  await beat(500);

  await app.chat.transcript.expandThoughtStep("Decision planning", "context", 0);
  await beat(800);
  await app.chat.transcript.expandThoughtStep("Decision planning", "reasoning", 0);
  await beat(800);
});
