import type { AgentToolConfig } from "../../../backend/src/agents/agent.entity";
import type { UserMessageEntry } from "@/protocol/chatEntry";
import {
  type ChatToolDraft,
  type ChatToolDraftEntry,
  type ToolOverrideUiMode,
  draftFromStoredOverrides,
  draftHasOverrides,
} from "./chatToolOverrides";

let draft = $state<ChatToolDraft>({});
let selectedToolForEdit = $state<string | null>(null);
let draftRevision = $state(0);

function touchDraft(): void {
  draftRevision += 1;
}

/** Subscribe in $derived so UI updates when draft mutates. */
export function getChatToolDraftRevision(): number {
  return draftRevision;
}

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
    touchDraft();
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
  touchDraft();
}

export function setToolDraftCustom(toolName: string, custom: AgentToolConfig): void {
  draft = {
    ...draft,
    [toolName]: { mode: "custom", custom },
  };
  touchDraft();
}

export function setSelectedToolForEdit(toolName: string | null): void {
  selectedToolForEdit = toolName;
}

function draftsEqual(a: ChatToolDraft, b: ChatToolDraft): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

export function resetChatToolDraft(): void {
  const hadOverrides = draftHasOverrides(draft);
  const hadSelection = selectedToolForEdit !== null;
  if (!hadOverrides && !hadSelection) return;
  draft = {};
  selectedToolForEdit = null;
  touchDraft();
}

export function seedChatToolDraftFromUserMessage(entry: UserMessageEntry | null): void {
  const next = draftFromStoredOverrides(entry?.overrides?.tools);
  const changed = !draftsEqual(draft, next) || selectedToolForEdit !== null;
  if (!changed) return;
  draft = next;
  selectedToolForEdit = null;
  touchDraft();
}
