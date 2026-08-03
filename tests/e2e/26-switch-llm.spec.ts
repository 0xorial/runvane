import { defaultAgentId, getConversationEntries, waitForNoPendingTasks } from "./harness/client";
import { expect, test } from "./fixtures";
import { E2E_LLM_TIMEOUT_MS } from "./timeouts";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

type PlannerEntry = {
  type: string;
  thoughtType?: string;
  conversationIndex: number;
  llm?: { providerId: string; model: string };
  status?: string;
};

// switch_llm is a lease, not a latch: the stub switches to stub/stub-fast for
// ONE planning round, does a tool call on the switched model, and the harness
// reverts on its own — the switched-to model never has to switch back.
test("switch_llm re-engines the next planning round and auto-reverts", async ({ app }) => {
  const agentId = await defaultAgentId(app.page.request);
  await app.chat.gotoNew(agentId);
  await app.chat.userInput.typeMessage("__switch_probe__ do the grunt work cheaply");
  await app.chat.userInput.send();

  await expect(app.chat.transcript.assistantMessage).toContainText("Switched for one round", {
    timeout: E2E_LLM_TIMEOUT_MS,
  });
  const conversationId = app.chat.conversationIdFromUrl();
  await waitForNoPendingTasks(app.page.request, { timeoutMs: E2E_LLM_TIMEOUT_MS, conversationId });

  const entries = (await getConversationEntries(app.page.request, conversationId)) as PlannerEntry[];
  const planners = entries
    .filter((e) => e.type === "thought" && e.thoughtType === "planner")
    .sort((a, b) => a.conversationIndex - b.conversationIndex);
  expect(planners.length).toBe(3);

  // Round 1 (decides to switch) runs on the run's base model.
  expect(planners[0].llm).toEqual({ providerId: "stub", model: "stub" });
  // Round 2 (after the accepted switch) runs on the switched model.
  expect(planners[1].llm).toEqual({ providerId: "stub", model: "stub-fast" });
  // Round 3: the 1-turn lease lapsed — reverted to the base model, no
  // switch-back call anywhere.
  expect(planners[2].llm).toEqual({ providerId: "stub", model: "stub" });

  // Both tool calls (switch_llm, get_current_time) completed.
  const tools = entries.filter((e) => e.type === "tool-invocation");
  expect(tools.map((t) => (t as { toolId?: string }).toolId).sort()).toEqual([
    "get_current_time",
    "switch_llm",
  ]);
});
