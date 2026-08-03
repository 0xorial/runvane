import { defaultAgentId, getConversationEntries, waitForNoPendingTasks } from "./harness/client";
import { expect, test } from "./fixtures";
import { E2E_LLM_TIMEOUT_MS } from "./timeouts";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

type PlannerEntry = { type: string; thoughtType?: string; conversationIndex: number; llmRequest?: string };

// Once the last todo_write is ≥6 message-entries back, the planner request must
// carry a tail reminder with the current list; fresher rounds must not. The stub
// records a 3-item list on the probe turn, then every follow-up finalizes
// without tools, so each exchange adds exactly 2 entries (user + assistant).
test("planner re-injects a stale to-do list as a tail reminder", async ({ app }) => {
  const agentId = await defaultAgentId(app.page.request);
  await app.chat.gotoNew(agentId);
  await app.chat.userInput.typeMessage("__todo_probe__ plan and execute the task");
  await app.chat.userInput.send();
  // The probe turn yields two assistant rows: "Here is my plan." + the finalize.
  await app.chat.transcript.waitForAssistantMessageCount(2, E2E_LLM_TIMEOUT_MS);
  const conversationId = app.chat.conversationIdFromUrl();

  // Distance from todo_write grows 2 per follow-up: the planner for follow-ups
  // 1-2 sees it 2 and 4 entries back (fresh); follow-up 3 plans at 6 → stale.
  for (let i = 1; i <= 3; i++) {
    await app.chat.userInput.typeMessage(`follow-up ${i}`);
    await app.chat.userInput.send();
    await app.chat.transcript.waitForAssistantMessageCount(2 + i, E2E_LLM_TIMEOUT_MS);
  }
  await waitForNoPendingTasks(app.page.request, { timeoutMs: E2E_LLM_TIMEOUT_MS, conversationId });

  const entries = (await getConversationEntries(app.page.request, conversationId)) as PlannerEntry[];
  const planners = entries
    .filter((e) => e.type === "thought" && e.thoughtType === "planner")
    .sort((a, b) => a.conversationIndex - b.conversationIndex);
  // probe turn (2 rounds: tool call + continuation) + 3 follow-ups = 5 rounds.
  expect(planners.length).toBe(5);

  const last = planners[planners.length - 1];
  expect(last.llmRequest ?? "").toContain("current to-do list");
  expect(last.llmRequest ?? "").toContain("- [in_progress] Implement the feature");
  expect(last.llmRequest ?? "").toContain("- [pending] Write tests");

  // Every earlier round was still fresh — no reminder.
  for (const planner of planners.slice(0, -1)) {
    expect(planner.llmRequest ?? "").not.toContain("current to-do list");
  }
});
