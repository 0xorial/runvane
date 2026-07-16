import type { AgentToolConfig } from "../../../backend/src/agents/agent.entity";
import type { ContextFilesOverride } from "../../../backend/src/contracts/preinject";
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

/** Draft state for the per-message context-files selection (`overrides.contextFiles`).
 *  Single-shot like the knowledge draft: applies to the message being composed. */
export type ChatContextFilesDraft = {
  /** Candidate relPaths to fold in with the next message. */
  paths: string[];
  /** False until the user touches a checkbox. Untouched = follow the agent's
   *  preinject config (no override compiled — the automatic first-message
   *  scan applies); touched = explicit, even when `paths` is empty (that
   *  means "inject nothing"). */
  touched: boolean;
};

export const EMPTY_CONTEXT_FILES_DRAFT: ChatContextFilesDraft = { paths: [], touched: false };

export function compileContextFilesOverride(draft: ChatContextFilesDraft): ContextFilesOverride | undefined {
  if (!draft.touched && draft.paths.length === 0) return undefined;
  return { paths: [...draft.paths] };
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
  contextFilesDraft?: ChatContextFilesDraft,
): UserMessageOverrides | undefined {
  const tools = compileChatToolOverrides(draft);
  const knowledge = knowledgeDraft ? compileKnowledgeOverride(knowledgeDraft) : undefined;
  const contextFiles = contextFilesDraft ? compileContextFilesOverride(contextFilesDraft) : undefined;
  if (!tools && !knowledge && !contextFiles) return undefined;
  return {
    version: 1,
    ...(tools ? { tools } : {}),
    ...(knowledge ? { knowledge } : {}),
    ...(contextFiles ? { contextFiles } : {}),
  };
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
