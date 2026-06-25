import {
  ATTACHMENT_MSG,
  FORBID_AGENT_ID,
  GUARDED_AGENT_ID,
  PROBE_MESSAGE,
  STUB_ATTACHMENT_SUMMARY_REPLY,
  STUB_GUARDRAIL_FLAG_REASON,
  USER_MSG_HELLO,
  defaultAgentId,
} from "./harness/client";
import path from "node:path";
import { expect, test } from "./fixtures";
import { E2E_LLM_TIMEOUT_MS } from "./timeouts";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

const attachmentFixture = path.join(process.cwd(), "e2e/fixtures/e2e-attachment.txt");

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

test("guardrail flags tool and user denial rejects it", async ({ app }) => {
  await app.chat.gotoNew(GUARDED_AGENT_ID);
  await app.chat.userInput.typeMessage(PROBE_MESSAGE);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForToolState("requested");
  const tool = app.chat.transcript.toolRow();
  await expect(tool.getByTestId("tool-deny-button")).toBeVisible();
  await tool.getByTestId("tool-deny-button").click();
  await app.chat.transcript.waitForToolState("denied");
  await expect(tool).toContainText("Denied");
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

test("attachment summary follow-up queries full file via ask_attachment", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.chat.userInput.attachFiles(attachmentFixture);
  await app.chat.userInput.setAttachmentMode("Summary");
  await app.chat.userInput.typeMessage(ATTACHMENT_MSG);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply(E2E_LLM_TIMEOUT_MS);

  await app.chat.userInput.typeMessage("What exact palette and mood does the full file suggest?");
  await app.chat.userInput.send();
  await app.chat.transcript.waitForToolState("done", 0, E2E_LLM_TIMEOUT_MS);
  await expect(app.chat.transcript.toolRow(0)).toContainText("ask_attachment");
  await app.chat.transcript.expectTranscriptContains("Cool violet");
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

test("try model branch from prepare step chip", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.sidebar.runProbeTime();
  await app.chat.transcript.waitForProbeComplete();
  await app.chat.transcript.expectNoBranchSelectors();

  const row = app.chat.transcript.prepareRow("Decision planning", 0);
  const tryModel = row.getByTestId("thought-prepare-try-model");
  await expect(tryModel).toBeVisible();
  await tryModel.hover();
  await expect(app.page.getByRole("tooltip", { name: "Try with different model" })).toBeVisible();

  await tryModel.click();
  const modelOption = app.page.getByRole("button", { name: "stub-model" });
  await expect(modelOption).toBeVisible();
  const reprocessDone = app.page.waitForResponse(
    (res) => res.url().includes("/reprocess-context") && res.status() === 202,
  );
  await modelOption.click();
  await reprocessDone;
  await expect(row.getByTestId("branch-selector")).toBeVisible({ timeout: E2E_LLM_TIMEOUT_MS });
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
