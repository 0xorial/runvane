import type { AgenticFollowup, AgenticToolCall } from "../types/chatEntry.js";

export const DEFAULT_MAX_PLANNER_TURNS = 3;
export const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 4;

export function clampToolCallsForTurn(
  toolCalls: AgenticToolCall[],
  maxToolCallsPerTurn: number = DEFAULT_MAX_TOOL_CALLS_PER_TURN,
): AgenticToolCall[] {
  const safeLimit = Math.max(0, Math.trunc(maxToolCallsPerTurn));
  return toolCalls.slice(0, safeLimit);
}

export function shouldContinuePlannerLoop(followup: AgenticFollowup): boolean {
  return followup === "continue_with_results" || followup === "retry_with_adjustment";
}
