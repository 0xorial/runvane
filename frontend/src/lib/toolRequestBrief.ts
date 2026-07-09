import type { ToolInvocationEntry } from "@/protocol/chatEntry";

/**
 * The model's own few-word purpose line for a tool call, written in the same
 * planning turn as the call — no extra LLM call:
 *
 * - `parameters.tool_note`: the planner's explicit note ("check current
 *   server time"), requested by the planner protocol for every call.
 * - Fallback for resolution-route calls from before notes existed: the
 *   natural-language `tool_request` brief. Direct-args calls put raw params
 *   JSON in that slot — that is not an explanation, so it's filtered out.
 */
export function toolRequestBrief(entry: ToolInvocationEntry): string {
  const params = entry.parameters as Record<string, unknown>;
  const note = params.tool_note;
  if (typeof note === "string" && note.trim()) return note.trim();
  const raw = params.tool_request;
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  if (!text || text.startsWith("{") || text.startsWith("[")) return "";
  return text;
}
