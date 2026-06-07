import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATTACHMENT_MSG,
  FORBID_AGENT_ID,
  GUARDED_AGENT_ID,
  PROBE_MESSAGE,
  STUB_ATTACHMENT_SUMMARY_REPLY,
  STUB_GUARDRAIL_FLAG_REASON,
  USER_MSG_HELLO,
  defaultAgentId,
} from "./api/client";
import { expect, test } from "./fixtures";
import { E2E_LLM_TIMEOUT_MS } from "./timeouts";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

const attachmentFixture = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../backend/test/fixtures/e2e-attachment.txt",
);

test("user message and title generation", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.chat.userInput.typeMessage(USER_MSG_HELLO);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForUserMessage();
  await expect(app.chat.transcript.userMessage).toContainText(USER_MSG_HELLO);
  await app.chat.transcript.waitForPrepareTitle("Title generation");
});

test("tool invocation on probe path", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();
  await app.chat.transcript.waitForToolState("done");
});

test("guardrail flags tool and user approval runs it", async ({ app }) => {
  await app.chat.gotoNew(GUARDED_AGENT_ID);
  await app.chat.userInput.typeMessage(PROBE_MESSAGE);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForToolState("requested");
  const tool = app.chat.transcript.toolRow();
  await expect(tool).toContainText("Guardrail flagged");
  await expect(tool).toContainText(STUB_GUARDRAIL_FLAG_REASON);
  await expect(tool.getByTestId("tool-approve-button")).toBeVisible();
  await tool.getByTestId("tool-approve-button").click();
  await app.chat.transcript.waitForToolState("done");
});

test("forbidden tool is rejected without approval affordance", async ({ app }) => {
  await app.chat.gotoNew(FORBID_AGENT_ID);
  await app.chat.userInput.typeMessage(PROBE_MESSAGE);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForToolState("error");
  await expect(app.chat.transcript.toolRow().getByTestId("tool-approve-button")).toHaveCount(0);
});

test("attachment direct mode shows file on user message", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.chat.userInput.attachFiles(attachmentFixture);
  await app.chat.userInput.setAttachmentMode("Direct");
  await app.chat.userInput.typeMessage(ATTACHMENT_MSG);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForUserMessage();
  await expect(app.chat.transcript.userMessage).toContainText(ATTACHMENT_MSG);
  await expect(app.chat.transcript.userMessage).toContainText("e2e-attachment.txt");
});

test("attachment summary mode runs summarize-attachment thought", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.chat.userInput.attachFiles(attachmentFixture);
  await app.chat.userInput.setAttachmentMode("Summary");
  await app.chat.userInput.typeMessage(ATTACHMENT_MSG);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForPrepareTitle("Summarize attachment");
  await app.chat.transcript.waitForAssistantReply();
  await app.chat.transcript.expandThoughtStep("Summarize attachment", "reasoning");
  await expect(app.chat.transcript.prepareRow("Summarize attachment")).toContainText(STUB_ATTACHMENT_SUMMARY_REPLY);
});

test("branch on user message reprocess", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.chat.userInput.typeMessage(USER_MSG_HELLO);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();
  await app.chat.transcript.expectNoBranchSelectors();

  const row = app.chat.transcript.userMessageRow();
  await row.getByTestId("user-message-edit").click();
  await row.locator("textarea").fill(`${USER_MSG_HELLO} edited`);
  const reprocessDone = app.page.waitForResponse(
    (res) => res.url().includes("/reprocess") && res.status() === 202,
  );
  await row.getByTestId("user-message-reprocess").click();
  await reprocessDone;
  await app.chat.transcript.waitForBranchSelectors(1);
});

test("branch on context reprocess", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();
  await app.chat.transcript.expectNoBranchSelectors();

  await app.chat.transcript.expandThoughtStep("Decision planning", "context", 0);
  const row = app.chat.transcript.prepareRow("Decision planning", 0);
  await row.getByRole("button", { name: "Edit" }).click();
  const reprocessDone = app.page.waitForResponse(
    (res) => res.url().includes("/reprocess-context") && res.status() === 202,
  );
  await row.getByTestId("thought-context-apply").click();
  await reprocessDone;
  await expect(app.chat.transcript.prepareRow("Decision planning", 0).getByTestId("branch-selector")).toBeVisible({
    timeout: E2E_LLM_TIMEOUT_MS,
  });
});
