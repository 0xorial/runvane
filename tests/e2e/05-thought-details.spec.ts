import { defaultAgentId } from "./harness/client";
import { stubLlmConfigure } from "./harness/stub-llm";
import { expect, test } from "./fixtures";
import { E2E_LLM_TIMEOUT_MS } from "./timeouts";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("collapsed thought rows open their stage details in the right panel", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();

  await app.chat.transcript.openThoughtDetails("Title generation");
  await app.chat.transcript.expectThoughtPanel("context");
  await expect(app.chat.transcript.detailPanel.getByText("model:").first()).toBeVisible();

  await app.chat.transcript.openThoughtDetails("Decision planning", 0);
  await app.chat.transcript.expectThoughtPanel("reasoning");
  await expect(app.chat.transcript.detailPanel.getByText("Raw response")).toBeVisible();
});

test("reprocess reasoning from the details panel", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();

  await app.chat.transcript.openThoughtDetails("Decision planning", 0);
  const panel = app.chat.transcript.detailPanel;
  await panel.getByTestId("thought-reprocess-edit").click();
  await expect(panel.getByTestId("thought-reprocess-apply")).toBeVisible();

  const reprocessDone = app.page.waitForResponse(
    (res) => res.url().includes("/reprocess-reason") && res.status() === 202,
  );
  await panel.getByTestId("thought-reprocess-apply").click();
  await reprocessDone;

  await expect(panel.getByTestId("thought-reprocess-apply")).toBeHidden({ timeout: E2E_LLM_TIMEOUT_MS });
  await expect(panel.getByTestId("thought-reprocess-edit")).toBeVisible();
  await expect(panel.getByText("Raw response")).toBeVisible();
});

test("edit response edits the assembled text, never the raw chunk transport", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  // First turn runs on default stub replies — title and planner race for the
  // shared fallback queue on a first message, so nothing is queued yet.
  await app.chat.userInput.typeMessage("hello there");
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();

  // A STREAMED stub reply captures provider-style raw chunks (like every real
  // adapter): llmResponse holds the chunk-transport JSON and assembledResponse
  // the actual reply. On a follow-up turn the planner is the only LLM
  // consumer, so the queued response deterministically feeds it.
  const reply = "streamed stub reply for editing";
  await stubLlmConfigure(request, [{ responses: [{ text: reply, streamMs: 1 }] }]);
  await app.chat.userInput.typeMessage("stream this one");
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantMessageCount(2);
  await app.chat.transcript.expectTranscriptContains(reply);

  await app.chat.transcript.openThoughtDetails("Decision planning", 1);
  const panel = app.chat.transcript.detailPanel;
  // The chunked shape actually materialized: both views present.
  await expect(panel.getByText("Assembled response")).toBeVisible();
  await expect(panel.getByText("Raw response")).toBeVisible();

  await panel.getByTestId("thought-reprocess-edit").click();
  const reprocessRequest = app.page.waitForRequest(
    (req) => req.url().includes("/reprocess-reason") && req.method() === "POST",
  );
  await panel.getByTestId("thought-reprocess-apply").click();
  // Applying the unchanged editor must post the assembled reply — if the
  // editor had seeded from llmResponse it would post `[{"choices":…` chunks.
  const body = (await reprocessRequest).postDataJSON() as { editedResponse: string };
  expect(body.editedResponse).toBe(reply);

  await expect(panel.getByTestId("thought-reprocess-apply")).toBeHidden({ timeout: E2E_LLM_TIMEOUT_MS });
  await expect(panel.getByText("Raw response")).toBeVisible();
});
