import { defaultAgentId, SPLIT_MSG_ONE, SPLIT_MSG_TWO } from "./harness/client";
import { test, expect } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("split moves the message and everything after it into a new forked conversation", async ({
  app,
  request,
}) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  // Two turns in one conversation.
  await app.chat.userInput.typeMessage(SPLIT_MSG_ONE);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();

  await app.chat.userInput.typeMessage(SPLIT_MSG_TWO);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForUserMessageCount(2);
  await app.chat.transcript.waitForAssistantMessageCount(2);

  const sourceId = app.chat.conversationIdFromUrl();

  // Split at the second user message → it and its reply move to a new chat.
  await app.chat.transcript.splitFromUserMessage(1);
  const forkedId = await app.chat.waitForConversationChange(sourceId);
  expect(forkedId).not.toBe(sourceId);

  // The new conversation holds the split-off turn and links back to its source.
  await app.chat.transcript.waitForUserMessage();
  await app.chat.transcript.expectTranscriptContains(SPLIT_MSG_TWO);
  await app.chat.transcript.expectTranscriptNotContains(SPLIT_MSG_ONE);
  await expect(app.chat.forkedFromBanner).toBeVisible();

  // The source kept the first turn, lost the split-off one, and has no banner.
  await app.chat.open(sourceId);
  await app.chat.transcript.waitForUserMessage();
  await app.chat.transcript.expectTranscriptContains(SPLIT_MSG_ONE);
  await app.chat.transcript.expectTranscriptNotContains(SPLIT_MSG_TWO);
  await expect(app.chat.forkedFromBanner).toBeHidden();
});
