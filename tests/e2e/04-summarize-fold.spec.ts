import { defaultAgentId, FOLD_MSG_ONE, FOLD_MSG_TWO, STUB_SUMMARIZE_REPLY } from "./harness/client";
import { test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("fold from second user message hides tail and shows checkpoint summary", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  await app.chat.userInput.typeMessage(FOLD_MSG_ONE);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();

  await app.chat.userInput.typeMessage(FOLD_MSG_TWO);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForUserMessageCount(2);
  await app.chat.transcript.waitForAssistantMessageCount(2);

  await app.chat.transcript.foldFromUserMessage(1);
  await app.chat.transcript.waitForCheckpointSummary(STUB_SUMMARIZE_REPLY);

  await app.chat.transcript.expectTranscriptContains(FOLD_MSG_ONE);
  await app.chat.transcript.expectTranscriptNotContains(FOLD_MSG_TWO);
});
