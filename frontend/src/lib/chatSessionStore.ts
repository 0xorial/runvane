import {
  linkAppend,
  linkRekey,
  patchLinked,
  toLinkedEntries,
  type LinkedChatEntry,
} from "./linkedChatEntry";
import type { ChatEntry } from "@/protocol/chatEntry";
import type { ObservableItemCollection } from "@/utils/observableCollection";

function getLinked(store: ObservableItemCollection<LinkedChatEntry>, id: string): LinkedChatEntry | undefined {
  return store.getById(id)?.get();
}

export function replaceSessionEntries(
  store: ObservableItemCollection<LinkedChatEntry>,
  entries: ChatEntry[],
): void {
  store.replace(toLinkedEntries(entries));
}

export function appendSessionEntry(
  store: ObservableItemCollection<LinkedChatEntry>,
  entry: ChatEntry,
): boolean {
  const linked: LinkedChatEntry = { ...entry, childIds: [] };
  if (!store.append(linked)) return false;
  linkAppend(linked, (id) => getLinked(store, id));
  return true;
}

export function rekeySessionEntry(
  store: ObservableItemCollection<LinkedChatEntry>,
  oldId: string,
  next: ChatEntry,
): boolean {
  const existing = getLinked(store, oldId);
  if (!existing) return false;
  const linked = patchLinked(existing, next);
  if (!store.replaceById(oldId, linked)) return false;
  linkRekey(oldId, linked, (id) => getLinked(store, id));
  return true;
}

export function upsertSessionEntry(
  store: ObservableItemCollection<LinkedChatEntry>,
  entry: ChatEntry,
): "appended" | "patched" | "unchanged" {
  const existing = getLinked(store, entry.id);
  if (existing) {
    store.replaceById(entry.id, patchLinked(existing, entry));
    return "patched";
  }
  if (appendSessionEntry(store, entry)) return "appended";
  return "unchanged";
}
