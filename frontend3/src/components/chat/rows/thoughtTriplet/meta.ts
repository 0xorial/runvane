import type { ThoughtActionEntry, ThoughtStreamEntry } from "@/protocol/chatEntry";
import { formatTokenCount } from "@/utils/formatTokenCount";

export function displayStatus(status: string): string {
  return status === "completed" ? "" : status;
}

export function reasonMetaLabel(stream: ThoughtStreamEntry): string {
  const provider = String(stream.llm?.providerId || "").trim() || "unknown-provider";
  const model = String(stream.llm?.model || "").trim() || "unknown-model";
  const status = displayStatus(stream.status ?? "running");
  const promptTokens = stream.promptTokens ?? 0;
  const cachedPromptTokens = stream.cachedPromptTokens ?? 0;
  const completionTokens = stream.completionTokens ?? 0;
  const totalTokens = promptTokens + cachedPromptTokens + completionTokens;
  const tokenLabel = totalTokens > 0 ? formatTokenCount(totalTokens) : "";
  const durationLabel = stream.thoughtMs != null ? `${Math.round(stream.thoughtMs)}ms` : "";
  return [tokenLabel, durationLabel, `${provider}/${model}`, status].filter(Boolean).join(" · ");
}

export function actionMetaLabel(
  actionEntry: ThoughtActionEntry | null,
  stream: ThoughtStreamEntry,
): { usesTool: boolean; status: string; toolName: string | null } {
  const toolName = String(actionEntry?.toolName || "").trim();
  const action = String(actionEntry?.action || "").trim();
  const decision = stream.type === "planner_llm_stream" ? (stream.decision ?? null) : null;
  const streamToolName = decision?.type === "tool-invocation" ? String(decision.toolId || "").trim() : "";
  const streamTool = streamToolName.length > 0;
  const usesTool = Boolean(toolName) || action === "tool_call" || streamTool;
  return {
    usesTool,
    status: displayStatus(actionEntry?.status ?? stream.status ?? "running"),
    toolName: toolName || streamToolName || null,
  };
}
