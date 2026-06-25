import type { AgentListItemResponse } from "../../../../../../backend/src/contracts/agents";
import type { ChatEntry, ThoughtActionEntry, ThoughtStreamEntry, UserMessageEntry } from "@/protocol/chatEntry";
import { getAgentLlm } from "@/pages/settings/agentLlm";
import { streamTotalTokens } from "@/lib/providerCost";
import { formatTokenCount } from "@/utils/formatTokenCount";

export function findAncestorUserMessage(
  startParentId: string | null | undefined,
  entriesById: ReadonlyMap<string, ChatEntry>,
): UserMessageEntry | null {
  let id = startParentId ?? null;
  while (id) {
    const entry = entriesById.get(id);
    if (!entry) return null;
    if (entry.type === "user-message") return entry;
    id = entry.parentId;
  }
  return null;
}

export function isAgentDefaultLlm(
  llm: { providerId?: string; model?: string } | null | undefined,
  agent: AgentListItemResponse | null | undefined,
): boolean {
  if (!agent) return false;
  const defaultLlm = getAgentLlm(agent);
  const provider = String(defaultLlm.provider_id ?? "").trim();
  const model = String(defaultLlm.model ?? "").trim();
  if (!provider || !model) return false;
  const streamProvider = String(llm?.providerId ?? "").trim();
  const streamModel = String(llm?.model ?? "").trim();
  return streamProvider === provider && streamModel === model;
}

export function displayStatus(status: string): string {
  return status === "completed" ? "" : status;
}

export function reasonMetaLabel(stream: ThoughtStreamEntry): string {
  const provider = String(stream.llm?.providerId || "").trim() || "unknown-provider";
  const model = String(stream.llm?.model || "").trim() || "unknown-model";
  const status = displayStatus(stream.status ?? "running");
  const totalTokens = streamTotalTokens(stream);
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
  const decision = stream.thoughtType === "planner" ? (stream.decision ?? null) : null;
  const streamToolName = decision?.type === "tool-invocation" ? String(decision.toolId || "").trim() : "";
  const streamTool = streamToolName.length > 0;
  const usesTool = Boolean(toolName) || action === "tool_call" || streamTool;
  return {
    usesTool,
    status: displayStatus(actionEntry?.status ?? stream.status ?? "running"),
    toolName: toolName || streamToolName || null,
  };
}
