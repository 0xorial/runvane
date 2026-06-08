import { get, writable } from "svelte/store";

const selectedIdsStore = writable<string[]>([]);
export const conversationSelectionRevision = writable(0);

function touch(): void {
  conversationSelectionRevision.update((n) => n + 1);
}

export function getSelectedConversationIds(): string[] {
  return get(selectedIdsStore);
}

export function setSelectedConversationIds(ids: string[]): void {
  selectedIdsStore.set(ids);
  touch();
}

export function toggleConversationSelected(id: string, checked: boolean): void {
  const current = get(selectedIdsStore);
  const next = checked
    ? current.includes(id)
      ? current
      : [...current, id]
    : current.filter((rowId) => rowId !== id);
  selectedIdsStore.set(next);
  touch();
}

export function clearConversationSelection(): void {
  if (get(selectedIdsStore).length === 0) return;
  selectedIdsStore.set([]);
  touch();
}
