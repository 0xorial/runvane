import type { ChatEntry, UserMessageEntry } from "../../types/chatEntry.js";
import { usageByConversationId } from "../conversationUsage.js";
import type { ContinueConversationProcessorDeps, LlmOverrides, ToolConfig } from "./types.js";

export function publishConversationUpdated(deps: ContinueConversationProcessorDeps, conversationId: string): void {
  const conversation = deps.conversations.get(conversationId, { includeDeleted: true });
  if (!conversation) return;
  deps.hub.publish(conversationId, {
    type: "conversation_updated",
    conversation: {
      id: conversation.id,
      title: conversation.title,
      groupId: conversation.group_id,
      isDeleted: Number(conversation.is_deleted ?? 0) === 1,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      lastMessageAt: conversation.last_message_at || conversation.created_at,
      promptTokensTotal: conversation.prompt_tokens_total,
      cachedPromptTokensTotal: conversation.cached_prompt_tokens_total,
      completionTokensTotal: conversation.completion_tokens_total,
      tokenUsageByModel: usageByConversationId(deps.chatEntries.listConversationTokenUsageByModel()).get(conversationId) ?? [],
    },
  });
}

export function agentToolConfigFor(
  deps: ContinueConversationProcessorDeps,
  agentId: string,
  toolName: string,
): ToolConfig {
  const agent = deps.agents.get(agentId);
  const toolCfg = agent?.default_llm_configuration?.tools?.[toolName];
  const enabled = toolCfg?.enabled === undefined ? true : toolCfg.enabled === true;
  const policy = toolCfg?.policy ?? "allow";
  const tool = deps.tools.get(toolName);
  const defaultRules =
    tool && typeof tool.getDefaultRules() === "object" && tool.getDefaultRules() != null
      ? (tool.getDefaultRules() as unknown as Record<string, unknown>)
      : {};
  const rules = toolCfg?.rules ?? defaultRules;
  return { enabled, policy, ...(rules ? { rules } : {}) };
}

export function resolveLlmOverrides(
  deps: ContinueConversationProcessorDeps,
  anchorUserMessage: UserMessageEntry,
): LlmOverrides {
  const agent = deps.agents.get(anchorUserMessage.agentId);
  const llmProviderId =
    anchorUserMessage.llmProviderId ?? agent?.default_llm_configuration?.provider_id ?? agent?.model_reference?.provider_id;
  const llmModel =
    anchorUserMessage.llmModel ?? agent?.default_llm_configuration?.model_name ?? agent?.model_reference?.model_name;
  return {
    ...(llmProviderId ? { llmProviderId } : {}),
    ...(llmModel ? { llmModel } : {}),
  };
}

export function resolvePlannerModel(deps: ContinueConversationProcessorDeps, overrides: { llmModel?: string }): string {
  const doc = deps.llmProviderSettings.getDocument();
  return String(overrides.llmModel || doc.llm_configuration.model_name || "gpt-4o-mini");
}

function parseStructuredParamValue(key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (key === "response_format" || key === "json_schema" || key === "schema" || key === "structured_output") {
    return JSON.parse(trimmed);
  }
  return value;
}

export function resolveRequestParams(
  deps: ContinueConversationProcessorDeps,
  input: { modelPresetId?: number | null },
): Record<string, unknown> {
  const doc = deps.llmProviderSettings.getDocument();
  const out: Record<string, unknown> = {};
  const globalSettings = doc.llm_configuration.model_settings;
  if (globalSettings && typeof globalSettings === "object" && !Array.isArray(globalSettings)) {
    for (const [key, value] of Object.entries(globalSettings)) {
      out[key] = parseStructuredParamValue(key, value);
    }
  }
  if (typeof input.modelPresetId === "number") {
    const preset = deps.modelPresets.get(input.modelPresetId);
    if (!preset) {
      throw new Error(`model preset not found: ${input.modelPresetId}`);
    }
    for (const [key, value] of Object.entries(preset.parameters ?? {})) {
      out[key] = parseStructuredParamValue(key, value);
    }
  }
  return out;
}

export function buildInputFiles(
  deps: ContinueConversationProcessorDeps,
  anchorUserMessage: UserMessageEntry,
): Array<{ filename: string; mimeType: string; base64Data: string }> {
  return (anchorUserMessage.attachments ?? []).map((attachment) => {
    const content = deps.uploads.readContentById(attachment.id);
    if (!content) throw new Error(`attachment content not found: ${attachment.id}`);
    return {
      filename: attachment.name,
      mimeType: attachment.mimeType || "application/octet-stream",
      base64Data: content.data.toString("base64"),
    };
  });
}

export function enabledToolIdsForAgent(deps: ContinueConversationProcessorDeps, agentId: string): string[] {
  return deps.tools
    .list()
    .filter((tool) => agentToolConfigFor(deps, agentId, tool.getName()).enabled)
    .map((tool) => tool.getName());
}

export function priorToolResultsFromEntries(
  entries: ChatEntry[],
): Array<{ toolId: string; ok: boolean; output: unknown; error: string | null }> {
  return entries
    .filter((entry): entry is Extract<ChatEntry, { type: "tool-invocation" }> => entry.type === "tool-invocation")
    .slice(-8)
    .map((entry) => {
      const result =
        entry.result && typeof entry.result === "object" && !Array.isArray(entry.result)
          ? (entry.result as Record<string, unknown>)
          : {};
      return {
        toolId: String(result.toolId ?? entry.toolId),
        ok: result.ok === true,
        output: result.output ?? null,
        error: typeof result.error === "string" ? result.error : null,
      };
    });
}

export function lineageEntries(entries: ChatEntry[], leafEntryId: string): ChatEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const out: ChatEntry[] = [];
  let cursor: ChatEntry | undefined = byId.get(leafEntryId);
  while (cursor) {
    out.push(cursor);
    const parentId = cursor.parentId;
    cursor = parentId ? byId.get(parentId) : undefined;
  }
  return out.reverse();
}
