import type { LlmRef } from "../../../backend/src/contracts/llm";
import type { LinkedChatEntry } from "@/lib/linkedChatEntry";

export const PLANNER_PREPARE_TITLE = "Decision planning";

export function resolveLastPlannerLlmOnPath(entries: LinkedChatEntry[]): LlmRef | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.type !== "thought-prepare" || entry.title !== PLANNER_PREPARE_TITLE) continue;
    const providerId = entry.llm?.providerId?.trim() ?? "";
    const model = entry.llm?.model?.trim() ?? "";
    if (!providerId || !model) continue;
    return { providerId, model };
  }
  return null;
}
