import { defaultAgentId } from "./harness/client";
import { stubLlmConfigure } from "./harness/stub-llm";
import { expect, test } from "./fixtures";
import { E2E_LLM_TIMEOUT_MS } from "./timeouts";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// Composer keyboard contract: Enter sends (enqueues while the agent runs),
// Shift+Enter inserts a newline, Ctrl/Cmd+Shift+Enter steers a running agent.

test("Enter sends and Shift+Enter inserts a newline", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  const textarea = app.page.getByTestId("chat-user-input");
  await textarea.fill("first line");
  await textarea.press("Shift+Enter");
  await textarea.pressSequentially("second line");
  // Shift+Enter stayed local: a two-line draft, nothing posted.
  await expect(textarea).toHaveValue("first line\nsecond line");

  const sendRequest = app.page.waitForRequest(
    (req) => req.url().includes("/messages") && req.method() === "POST",
  );
  await textarea.press("Enter");
  const body = (await sendRequest).postDataJSON() as { message: string; steer?: boolean; enqueue?: boolean };
  expect(body.message).toBe("first line\nsecond line");
  expect(body.steer).toBeUndefined();
  expect(body.enqueue).toBeUndefined();
  await app.chat.transcript.waitForAssistantReply();
});

test("while the agent runs, Enter enqueues and Ctrl+Shift+Enter steers", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  // First turn on default stub replies (title and planner race for the shared
  // fallback queue on a first message — queue nothing yet).
  await app.chat.userInput.typeMessage("warm up");
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();

  // Second turn: only the planner consumes the queue — a slow streamed reply
  // keeps the agent visibly running while we exercise the shortcuts.
  await stubLlmConfigure(request, [{ responses: [{ text: "streaming slowly ".repeat(60), streamMs: 40 }] }]);
  await app.chat.userInput.typeMessage("long running turn");
  await app.chat.userInput.send();
  const textarea = app.page.getByTestId("chat-user-input");
  await expect(app.page.getByTestId("chat-enqueue-button")).toBeVisible({ timeout: E2E_LLM_TIMEOUT_MS });

  await textarea.fill("queued while running");
  const enqueueRequest = app.page.waitForRequest(
    (req) => req.url().includes("/messages") && req.method() === "POST",
  );
  await textarea.press("Enter");
  const enqueueBody = (await enqueueRequest).postDataJSON() as { message: string; enqueue?: boolean };
  expect(enqueueBody.message).toBe("queued while running");
  expect(enqueueBody.enqueue).toBe(true);

  await expect(app.page.getByTestId("chat-steer-button")).toBeVisible();
  await textarea.fill("steer the agent");
  const steerRequest = app.page.waitForRequest(
    (req) => req.url().includes("/messages") && req.method() === "POST",
  );
  await textarea.press("Control+Shift+Enter");
  const steerBody = (await steerRequest).postDataJSON() as { message: string; steer?: boolean };
  expect(steerBody.message).toBe("steer the agent");
  expect(steerBody.steer).toBe(true);

  // The steered turn (and the flushed queue) settle into visible replies.
  await app.chat.transcript.expectTranscriptContains("steer the agent");
});
