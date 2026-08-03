import { defaultAgentId, getConversationEntries, listConversations, waitForNoPendingTasks } from "./harness/client";
import { expect, test } from "./fixtures";
import { E2E_LLM_TIMEOUT_MS } from "./timeouts";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

type EntryRow = {
  type: string;
  toolId?: string;
  state?: string;
  text?: string;
  result?: { output?: { answer?: string; conversation_id?: string; planner_rounds?: number } };
};

// run_subagent spawns a REAL child conversation (fresh context, own planner
// loop), waits for it to settle, and returns its final answer to the parent.
test("run_subagent runs a child conversation and returns its answer", async ({ app }) => {
  const agentId = await defaultAgentId(app.page.request);
  await app.chat.gotoNew(agentId);
  await app.chat.userInput.typeMessage("__subagent_probe__ delegate the sub-task");
  await app.chat.userInput.send();

  await expect(app.chat.transcript.assistantMessage).toContainText("the answer is 42", {
    timeout: E2E_LLM_TIMEOUT_MS,
  });
  const conversationId = app.chat.conversationIdFromUrl();
  await waitForNoPendingTasks(app.page.request, { timeoutMs: E2E_LLM_TIMEOUT_MS });

  // The parent's tool call completed and carries the child's answer + link.
  const parentEntries = (await getConversationEntries(app.page.request, conversationId)) as EntryRow[];
  const toolEntry = parentEntries.find((e) => e.type === "tool-invocation" && e.toolId === "run_subagent");
  expect(toolEntry?.state).toBe("done");
  expect(toolEntry?.result?.output?.answer).toBe("Child result: 42.");
  const childId = toolEntry?.result?.output?.conversation_id;
  expect(childId).toBeTruthy();
  expect(toolEntry?.result?.output?.planner_rounds).toBe(1);

  // The child is a real, inspectable conversation: listed in the sidebar data
  // under the requested title, with the brief and the answer in its transcript.
  const { conversations } = await listConversations(app.page.request);
  const child = conversations.find((c) => c.id === childId);
  expect(child?.title).toBe("e2e subagent task");

  const childEntries = (await getConversationEntries(app.page.request, String(childId))) as EntryRow[];
  const childUser = childEntries.find((e) => e.type === "user-message");
  expect(childUser?.text ?? "").toContain("__subagent_child__");
  const childAssistant = childEntries.find((e) => e.type === "assistant-message");
  expect(childAssistant?.text).toBe("Child result: 42.");
});
