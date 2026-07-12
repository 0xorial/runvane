import type { AgentToolConfig } from "../../../backend/src/agents/agent.entity";
import type { UserMessageEntry } from "@/protocol/chatEntry";
import { get, writable } from "svelte/store";
import {
  type ChatRagDraft,
  type ChatToolDraft,
  type ChatToolDraftEntry,
  type ToolOverrideUiMode,
  EMPTY_RAG_DRAFT,
  draftFromStoredOverrides,
  draftHasOverrides,
} from "./chatToolOverrides";

const draftStore = writable<ChatToolDraft>({});
const ragDraftStore = writable<ChatRagDraft>({ ...EMPTY_RAG_DRAFT });
const selectedToolForEditStore = writable<string | null>(null);
export const chatToolDraftRevision = writable(0);

function touchDraft(): void {
  chatToolDraftRevision.update((n) => n + 1);
}

export function getChatToolDraftRevision(): number {
  return get(chatToolDraftRevision);
}

export function getChatToolDraft(): ChatToolDraft {
  return get(draftStore);
}

export function getChatRagDraft(): ChatRagDraft {
  return get(ragDraftStore);
}

export function setChatRagDraft(next: ChatRagDraft): void {
  ragDraftStore.set({ ...next, storages: [...next.storages] });
  touchDraft();
}

export function getSelectedToolForEdit(): string | null {
  return get(selectedToolForEditStore);
}

export function chatToolDraftHasOverrides(): boolean {
  // Deliberately excludes the rag draft: forced retrieval is a single-shot
  // composer action, not a tools-panel policy override.
  return draftHasOverrides(get(draftStore));
}

export function getToolDraftEntry(toolName: string): ChatToolDraftEntry {
  return get(draftStore)[toolName] ?? { mode: "inherit" };
}

export function setToolDraftMode(toolName: string, mode: ToolOverrideUiMode): void {
  const draft = get(draftStore);
  const prev = draft[toolName];
  if (mode === "inherit") {
    const next = { ...draft };
    delete next[toolName];
    draftStore.set(next);
    selectedToolForEditStore.update((selected) => (selected === toolName ? null : selected));
    touchDraft();
    return;
  }
  draftStore.set({
    ...draft,
    [toolName]: {
      mode,
      ...(mode === "custom" ? { custom: prev?.custom } : {}),
    },
  });
  if (mode === "custom") selectedToolForEditStore.set(toolName);
  else selectedToolForEditStore.update((selected) => (selected === toolName ? null : selected));
  touchDraft();
}

export function setToolDraftCustom(toolName: string, custom: AgentToolConfig): void {
  draftStore.update((draft) => ({
    ...draft,
    [toolName]: { mode: "custom", custom },
  }));
  selectedToolForEditStore.set(toolName);
  touchDraft();
}

export function setSelectedToolForEdit(toolName: string | null): void {
  const current = get(selectedToolForEditStore);
  if (current === toolName) return;
  selectedToolForEditStore.set(toolName);
  touchDraft();
}

function draftsEqual(a: ChatToolDraft, b: ChatToolDraft): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

export function resetChatToolDraft(): void {
  const draft = get(draftStore);
  const hadOverrides = draftHasOverrides(draft) || get(ragDraftStore).enabled;
  const hadSelection = get(selectedToolForEditStore) !== null;
  if (!hadOverrides && !hadSelection) return;
  draftStore.set({});
  ragDraftStore.set({ ...EMPTY_RAG_DRAFT });
  selectedToolForEditStore.set(null);
  touchDraft();
}

export function seedChatToolDraftFromUserMessage(entry: UserMessageEntry | null): void {
  // Tool overrides are a policy — they re-seed from the branch's last user
  // message. The rag draft deliberately does NOT: forced retrieval is a
  // single-shot action on the message being composed.
  const next = draftFromStoredOverrides(entry?.overrides?.tools);
  const draft = get(draftStore);
  const changed = !draftsEqual(draft, next) || get(selectedToolForEditStore) !== null;
  if (!changed) return;
  draftStore.set(next);
  selectedToolForEditStore.set(null);
  touchDraft();
}
