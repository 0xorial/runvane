import type { AgentToolConfig } from "../../../backend/src/agents/agent.entity";
import {
  type ChatToolDraft,
  type ChatToolDraftEntry,
  type ToolOverrideUiMode,
  draftHasOverrides,
} from "./chatToolOverrides";

let draft = $state<ChatToolDraft>({});
let selectedToolForEdit = $state<string | null>(null);

export function getChatToolDraft(): ChatToolDraft {
  return draft;
}

export function getSelectedToolForEdit(): string | null {
  return selectedToolForEdit;
}

export function chatToolDraftHasOverrides(): boolean {
  return draftHasOverrides(draft);
}

export function getToolDraftEntry(toolName: string): ChatToolDraftEntry {
  return draft[toolName] ?? { mode: "inherit" };
}

export function setToolDraftMode(toolName: string, mode: ToolOverrideUiMode): void {
  const prev = draft[toolName];
  if (mode === "inherit") {
    const next = { ...draft };
    delete next[toolName];
    draft = next;
    if (selectedToolForEdit === toolName) selectedToolForEdit = null;
    return;
  }
  draft = {
    ...draft,
    [toolName]: {
      mode,
      ...(mode === "custom" ? { custom: prev?.custom } : {}),
    },
  };
  if (mode === "custom") selectedToolForEdit = toolName;
  else if (selectedToolForEdit === toolName) selectedToolForEdit = null;
}

export function setToolDraftCustom(toolName: string, custom: AgentToolConfig): void {
  draft = {
    ...draft,
    [toolName]: { mode: "custom", custom },
  };
}

export function setSelectedToolForEdit(toolName: string | null): void {
  selectedToolForEdit = toolName;
}

export function resetChatToolDraft(): void {
  draft = {};
  selectedToolForEdit = null;
}

export function clearChatToolDraftOnConversationChange(): void {
  resetChatToolDraft();
}
