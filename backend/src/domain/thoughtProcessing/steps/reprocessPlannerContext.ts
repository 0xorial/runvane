import { lineageEntries } from "../../decisionTaskProcessor/context.js";
import type { PlannerLlmStreamEntry, UserMessageEntry } from "../../../types/chatEntry.js";
import { getThoughtRuntimeDeps } from "./runtimeDeps.js";

export function resolvePlannerReprocessContext(input: {
  conversationId: string;
  sourceEntryId: string;
}): {
  sourceEntry: PlannerLlmStreamEntry;
  anchorUserMessage: UserMessageEntry;
  enabledToolIds: string[];
} {
  const deps = getThoughtRuntimeDeps();
  const sourceEntry = deps.chatEntries.getMessage(input.conversationId, input.sourceEntryId);
  if (!sourceEntry || sourceEntry.type !== "planner_llm_stream") {
    throw new Error(`planner thought not found: ${input.sourceEntryId}`);
  }
  const entries = deps.chatEntries.listMessages(input.conversationId, { activePathOnly: false });
  const lineage = lineageEntries(entries, sourceEntry.id);
  const anchorUserMessage = [...lineage].reverse().find((entry): entry is UserMessageEntry => entry.type === "user-message") ?? null;
  if (!anchorUserMessage) {
    throw new Error(`cannot reprocess thought without ancestor user-message: ${input.sourceEntryId}`);
  }
  const enabledToolIds = deps.tools
    .list()
    .filter((tool) => {
      const cfg = deps.agents.get(anchorUserMessage.agentId)?.default_llm_configuration?.tools?.[tool.getName()];
      return cfg?.enabled !== false;
    })
    .map((tool) => tool.getName());
  return {
    sourceEntry,
    anchorUserMessage,
    enabledToolIds,
  };
}
