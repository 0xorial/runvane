import { FORBID_AGENT_ID, createProbeConversation, defaultAgentId } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("time-travel: switching chats keeps messages visible", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);

  const convA = await createProbeConversation(request, agentId);
  const convB = await createProbeConversation(request, agentId);

  await app.chat.open(convA);
  await app.chat.transcript.waitForUserMessage();

  await app.sidebar.openConversation(convB);
  await app.chat.transcript.waitForUserMessage();

  for (let i = 0; i < 2; i += 1) {
    await app.sidebar.openConversation(convA);
    await app.chat.transcript.waitForUserMessage();
    await app.sidebar.openConversation(convB);
    await app.chat.transcript.waitForUserMessage();
  }

  await app.sidebar.openConversation(convA);
  await app.chat.transcript.waitForAssistantReply();

  await app.sidebar.openConversation(convB);
  await app.chat.transcript.waitForAssistantReply();

  expect(convA).not.toEqual(convB);
});

test("switching chats updates the chat tools panel to the target conversation's agent", async ({
  app,
  request,
}) => {
  const defaultAgent = await defaultAgentId(request);
  const allowedConvo = await createProbeConversation(request, defaultAgent);
  const forbiddenConvo = await createProbeConversation(request, FORBID_AGENT_ID);

  const toolRow = app.page.getByTestId("chat-tools-panel").locator("li").filter({ hasText: "get_current_time" });

  await app.chat.open(allowedConvo);
  await expect(toolRow.getByRole("button", { name: "Allow" })).toHaveAttribute("aria-pressed", "true", {
    timeout: 15_000,
  });

  await app.sidebar.openConversation(forbiddenConvo);
  await expect(toolRow.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");

  await app.sidebar.openConversation(allowedConvo);
  await expect(toolRow.getByRole("button", { name: "Allow" })).toHaveAttribute("aria-pressed", "true");
});
