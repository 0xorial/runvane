import type { AgentListItemResponse } from "../../../../../../backend/src/contracts/agents";
import type { ChatEntry, ThoughtEntry, UserMessageEntry } from "@/protocol/chatEntry";
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

export function reasonMetaLabel(thought: ThoughtEntry): string {
  const provider = String(thought.llm?.providerId || "").trim() || "unknown-provider";
  const model = String(thought.llm?.model || "").trim() || "unknown-model";
  const status = displayStatus(thought.status);
  const totalTokens = streamTotalTokens(thought);
  const tokenLabel = totalTokens > 0 ? formatTokenCount(totalTokens) : "";
  const durationLabel = thought.thoughtMs != null ? `${Math.round(thought.thoughtMs)}ms` : "";
  return [tokenLabel, durationLabel, `${provider}/${model}`, status].filter(Boolean).join(" · ");
}

export function actionMetaLabel(thought: ThoughtEntry): {
  usesTool: boolean;
  status: string;
  toolName: string | null;
} {
  const toolName = String(thought.toolName || "").trim();
  const action = String(thought.action || "").trim();
  const decision = thought.thoughtType === "planner" ? (thought.decision ?? null) : null;
  const decisionToolName = decision?.type === "tool-invocation" ? String(decision.toolId || "").trim() : "";
  const usesTool = Boolean(toolName) || action === "tool_call" || decisionToolName.length > 0;
  return {
    usesTool,
    status: displayStatus(thought.stage === "decide" ? thought.status : "running"),
    toolName: toolName || decisionToolName || null,
  };
}
