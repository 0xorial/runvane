import type { ChatEntry } from "@/protocol/chatEntry";
import type { ObservableItemCollection } from "@/utils/observableCollection";

/** Session copy: protocol fields + childIds maintained on insert. parentId is the back-link. */
export type LinkedChatEntry = ChatEntry & { childIds: string[] };

export function byConversationIndexAsc(a: ChatEntry, b: ChatEntry): number {
  const ai = typeof a.conversationIndex === "number" ? a.conversationIndex : 0;
  const bi = typeof b.conversationIndex === "number" ? b.conversationIndex : 0;
  if (ai !== bi) return ai - bi;
  return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
}

export function toLinkedEntries(entries: ChatEntry[]): LinkedChatEntry[] {
  const linked = entries.map((entry) => ({ ...entry, childIds: [] as string[] }));
  const byId = new Map(linked.map((entry) => [entry.id, entry]));
  for (const entry of [...linked].sort(byConversationIndexAsc)) {
    linkChild(entry, byId);
  }
  return linked;
}

function sortChildIds(parent: LinkedChatEntry, byId: Map<string, LinkedChatEntry>): void {
  parent.childIds.sort((a, b) => byConversationIndexAsc(byId.get(a)!, byId.get(b)!));
}

export function linkChild(entry: LinkedChatEntry, byId: Map<string, LinkedChatEntry>): void {
  entry.childIds = [];
  if (entry.parentId === null) return;
  const parent = byId.get(entry.parentId);
  if (!parent) throw new Error(`linkedChatEntry: missing parent ${entry.parentId} for ${entry.id}`);
  parent.childIds.push(entry.id);
  sortChildIds(parent, byId);
}

export function linkAppend(entry: LinkedChatEntry, get: (id: string) => LinkedChatEntry | undefined): void {
  entry.childIds = [];
  if (entry.parentId === null) return;
  const parent = get(entry.parentId);
  if (!parent) throw new Error(`linkedChatEntry: missing parent ${entry.parentId} for ${entry.id}`);
  parent.childIds.push(entry.id);
  parent.childIds.sort((a, b) => byConversationIndexAsc(get(a)!, get(b)!));
}

export function linkRekey(
  oldId: string,
  next: LinkedChatEntry,
  get: (id: string) => LinkedChatEntry | undefined,
): void {
  if (next.id === oldId) return;
  const parentId = next.parentId;
  if (parentId === null) return;
  const parent = get(parentId);
  if (!parent) throw new Error(`linkedChatEntry.rekey: missing parent ${parentId}`);
  const childIndex = parent.childIds.indexOf(oldId);
  if (childIndex >= 0) parent.childIds[childIndex] = next.id;
}

export function patchLinked(existing: LinkedChatEntry, next: ChatEntry): LinkedChatEntry {
  return { ...next, childIds: existing.childIds };
}

export function rootsOf(store: ObservableItemCollection<LinkedChatEntry>): LinkedChatEntry[] {
  return store
    .getRows()
    .map((row$) => row$.get())
    .filter((entry) => entry.parentId === null)
    .sort(byConversationIndexAsc);
}

export function childEntries(
  store: ObservableItemCollection<LinkedChatEntry>,
  parentId: string | null,
): LinkedChatEntry[] {
  if (parentId === null) return rootsOf(store);
  const parent = store.getById(parentId)?.get();
  if (!parent) return [];
  return parent.childIds
    .map((id) => store.getById(id)?.get())
    .filter((entry): entry is LinkedChatEntry => entry != null);
}

export function siblingsOf(
  store: ObservableItemCollection<LinkedChatEntry>,
  entryId: string,
): LinkedChatEntry[] {
  const entry = store.getById(entryId)?.get();
  if (!entry) return [];
  return childEntries(store, entry.parentId);
}

export function lineTipId(
  store: ObservableItemCollection<LinkedChatEntry>,
  startId: string,
): string {
  let cursor = startId;
  for (;;) {
    const childIds = store.getById(cursor)?.get().childIds ?? [];
    if (childIds.length === 0) return cursor;
    cursor = childIds[childIds.length - 1];
  }
}

export function pathFromLeaf(
  store: ObservableItemCollection<LinkedChatEntry>,
  leafId: string | null,
): LinkedChatEntry[] {
  const tipId = resolvePathTipId(store, leafId);
  if (!tipId) return [];
  const path: LinkedChatEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | null = tipId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const entry: LinkedChatEntry | undefined = store.getById(cursor)?.get();
    if (!entry) break;
    path.push(entry);
    cursor = entry.parentId;
  }
  path.reverse();
  return path;
}

export function leafAfterAppend(
  store: ObservableItemCollection<LinkedChatEntry>,
  leafId: string | null,
  entry: ChatEntry,
): string | null {
  const path = pathFromLeaf(store, leafId);
  const onPath =
    entry.parentId == null ? path.length === 0 : path.some((row) => row.id === entry.parentId);
  if (!onPath) return leafId;
  return entry.id;
}

function resolvePathTipId(store: ObservableItemCollection<LinkedChatEntry>, leafId: string | null): string | null {
  if (store.getRows().length === 0) return null;
  if (leafId && store.getById(leafId)) return lineTipId(store, leafId);
  const roots = rootsOf(store);
  if (roots.length === 0) return null;
  return lineTipId(store, roots[roots.length - 1].id);
}
