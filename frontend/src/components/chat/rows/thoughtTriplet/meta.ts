import type { PlannerLlmStreamEntry, ThoughtActionEntry, TitleLlmStreamEntry } from "@/protocol/chatEntry";

export function displayStatus(status: string): string {
  return status === "completed" ? "" : status;
}

export function reasonMetaLabel(stream: PlannerLlmStreamEntry | TitleLlmStreamEntry): string {
  const provider = String(stream.llmProviderId || "").trim() || "unknown-provider";
  const model = String(stream.llmModel || "").trim() || "unknown-model";
  const status = displayStatus(stream.status ?? "running");
  const promptTokens = stream.promptTokens ?? 0;
  const cachedPromptTokens = stream.cachedPromptTokens ?? 0;
  const completionTokens = stream.completionTokens ?? 0;
  const totalTokens = promptTokens + cachedPromptTokens + completionTokens;
  const tokenLabel = totalTokens > 0 ? `${totalTokens}t` : "";
  const durationLabel = stream.thoughtMs != null ? `${Math.round(stream.thoughtMs)}ms` : "";
  return [tokenLabel, durationLabel, `${provider}/${model}`, status].filter(Boolean).join(" · ");
}

export function actionMetaLabel(
  actionEntry: ThoughtActionEntry | null,
  stream: PlannerLlmStreamEntry | TitleLlmStreamEntry,
): { usesTool: boolean; status: string; toolName: string | null } {
  const toolName = String(actionEntry?.toolName || "").trim();
  const action = String(actionEntry?.action || "").trim();
  const streamToolName = stream.decision?.type === "tool-invocation" ? String(stream.decision.toolId || "").trim() : "";
  const streamTool = streamToolName.length > 0;
  const usesTool = Boolean(toolName) || action === "tool_call" || streamTool;
  return {
    usesTool,
    status: displayStatus(actionEntry?.status ?? stream.status ?? "running"),
    toolName: toolName || streamToolName || null,
  };
}
