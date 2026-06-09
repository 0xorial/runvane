/** Planner JSON body the agent runtime expects from decision-planning LLM calls. */
export function plannerReply(assistantOutput: string, thinking = ""): string {
  return JSON.stringify({
    assistant_thinking: thinking,
    assistant_output: assistantOutput,
    tool_requests: [],
    followup: "finalize",
  });
}
