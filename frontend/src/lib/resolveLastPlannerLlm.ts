import type { LlmRef } from "../../../backend/src/contracts/llm";
import type { LinkedChatEntry } from "@/lib/linkedChatEntry";

export function resolveLastPlannerLlmOnPath(entries: LinkedChatEntry[]): LlmRef | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.type !== "thought" || entry.thoughtType !== "planner") continue;
    const providerId = entry.llm?.providerId?.trim() ?? "";
    const model = entry.llm?.model?.trim() ?? "";
    if (!providerId || !model) continue;
    return { providerId, model };
  }
  return null;
}
