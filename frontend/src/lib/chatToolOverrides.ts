import type { AgentToolConfig } from "../../../backend/src/agents/agent.entity";
import type { KnowledgeOverride } from "../../../backend/src/contracts/retrieval";
import type { UserMessageOverrides } from "../../../backend/src/contracts/user-message-overrides";

/** Draft state for the per-message forced-retrieval override (`overrides.knowledge`). */
export type ChatKnowledgeDraft = {
  enabled: boolean;
  /** Storage ids to ground the next message in. */
  storages: string[];
  topK?: number;
  /** 'verbatim' (default): the message text is the query.
   *  'preplanned': a knowledge-planning thought composes the queries at send time. */
  mode?: "verbatim" | "preplanned";
};

export const EMPTY_KNOWLEDGE_DRAFT: ChatKnowledgeDraft = { enabled: false, storages: [] };

export function compileKnowledgeOverride(draft: ChatKnowledgeDraft): KnowledgeOverride | undefined {
  if (!draft.enabled || draft.storages.length === 0) return undefined;
  return {
    storages: [...draft.storages],
    ...(draft.topK ? { top_k: draft.topK } : {}),
    ...(draft.mode === "preplanned" ? { mode: "preplanned" as const } : {}),
  };
}

export type ToolOverrideUiMode = "inherit" | "off" | "ask" | "allow" | "custom";

export type ExplicitToolOverrideMode = Exclude<ToolOverrideUiMode, "inherit">;

export type ChatToolDraftEntry = {
  mode: ToolOverrideUiMode;
  custom?: AgentToolConfig;
};

export type ChatToolDraft = Record<string, ChatToolDraftEntry>;

export function compileChatToolOverrides(draft: ChatToolDraft): Record<string, AgentToolConfig> | undefined {
  const tools: Record<string, AgentToolConfig> = {};
  for (const [toolName, entry] of Object.entries(draft)) {
    if (entry.mode === "inherit") continue;
    if (entry.mode === "custom") {
      if (entry.custom) tools[toolName] = entry.custom;
      continue;
    }
    // off | ask | allow map straight to the policy field.
    tools[toolName] = { policy: entry.mode };
  }
  return Object.keys(tools).length > 0 ? tools : undefined;
}

export function draftHasOverrides(draft: ChatToolDraft): boolean {
  return Object.values(draft).some((entry) => entry.mode !== "inherit");
}

export function compileUserMessageOverrides(
  draft: ChatToolDraft,
  knowledgeDraft?: ChatKnowledgeDraft,
): UserMessageOverrides | undefined {
  const tools = compileChatToolOverrides(draft);
  const knowledge = knowledgeDraft ? compileKnowledgeOverride(knowledgeDraft) : undefined;
  if (!tools && !knowledge) return undefined;
  return { version: 1, ...(tools ? { tools } : {}), ...(knowledge ? { knowledge } : {}) };
}

function deriveDraftEntryFromStored(cfg: AgentToolConfig): ChatToolDraftEntry {
  const policy = cfg.policy ?? "off";
  if (policy === "off") return { mode: "off" };
  // A plain ask/allow with no extra rules or guardrail maps to that segment;
  // anything richer (custom policy, or extra rules/guardrail) opens the editor.
  const plain = cfg.guardrail !== true && (cfg.rules == null || Object.keys(cfg.rules).length === 0);
  if ((policy === "ask" || policy === "allow") && plain) return { mode: policy };
  return { mode: "custom", custom: cfg };
}

/** Maps agent tool settings to the segment that represents them. */
export function effectiveAgentToolMode(cfg: {
  policy: ExplicitToolOverrideMode;
  guardrail: boolean;
  config: Record<string, unknown>;
}): ExplicitToolOverrideMode {
  return cfg.policy;
}

export function explicitModeLabel(mode: ExplicitToolOverrideMode): string {
  if (mode === "off") return "Off";
  if (mode === "ask") return "Ask";
  if (mode === "allow") return "Allow";
  return "Custom";
}

export function draftFromStoredOverrides(tools: Record<string, AgentToolConfig> | undefined): ChatToolDraft {
  if (!tools) return {};
  const draft: ChatToolDraft = {};
  for (const [toolName, cfg] of Object.entries(tools)) {
    draft[toolName] = deriveDraftEntryFromStored(cfg);
  }
  return draft;
}
