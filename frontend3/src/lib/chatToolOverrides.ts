import type { AgentToolConfig } from "../../../backend/src/agents/agent.entity";

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
