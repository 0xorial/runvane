import type { AgentToolConfig } from "../../../backend/src/agents/agent.entity";
import type { UserMessageOverrides } from "../../../backend/src/contracts/user-message-overrides";

export type ToolOverrideUiMode = "inherit" | "off" | "allow_all" | "custom";

export type ChatToolDraftEntry = {
  mode: ToolOverrideUiMode;
  custom?: AgentToolConfig;
};

export type ChatToolDraft = Record<string, ChatToolDraftEntry>;

export function compileChatToolOverrides(draft: ChatToolDraft): Record<string, AgentToolConfig> | undefined {
  const tools: Record<string, AgentToolConfig> = {};
  for (const [toolName, entry] of Object.entries(draft)) {
    if (entry.mode === "inherit") continue;
    if (entry.mode === "off") {
      tools[toolName] = { enabled: false };
      continue;
    }
    if (entry.mode === "allow_all") {
      tools[toolName] = { enabled: true, rules: { allowed: "always" }, guardrail: false };
      continue;
    }
    if (entry.mode === "custom" && entry.custom) {
      tools[toolName] = entry.custom;
    }
  }
  return Object.keys(tools).length > 0 ? tools : undefined;
}

export function draftHasOverrides(draft: ChatToolDraft): boolean {
  return Object.values(draft).some((entry) => entry.mode !== "inherit");
}

export function compileUserMessageOverrides(draft: ChatToolDraft): UserMessageOverrides | undefined {
  const tools = compileChatToolOverrides(draft);
  if (!tools) return undefined;
  return { version: 1, tools };
}

function deriveDraftEntryFromStored(cfg: AgentToolConfig): ChatToolDraftEntry {
  if (cfg.enabled === false) return { mode: "off" };
  if (cfg.enabled === true && cfg.rules?.allowed === "always" && cfg.guardrail === false) {
    return { mode: "allow_all" };
  }
  return { mode: "custom", custom: cfg };
}

export function draftFromStoredOverrides(tools: Record<string, AgentToolConfig> | undefined): ChatToolDraft {
  if (!tools) return {};
  const draft: ChatToolDraft = {};
  for (const [toolName, cfg] of Object.entries(tools)) {
    draft[toolName] = deriveDraftEntryFromStored(cfg);
  }
  return draft;
}
