import type { ChatEntry } from "@/protocol/chatEntry";

/** Session copy: parentId from server + isChosen at each fork for the active view. */
export type LinkedChatEntry = ChatEntry & { isChosen: boolean };

export type ChatEntryLookup = {
  getById: (id: string) => LinkedChatEntry | undefined;
  getRows: () => LinkedChatEntry[];
};

export function byConversationIndexAsc(a: ChatEntry, b: ChatEntry): number {
  const ai = typeof a.conversationIndex === "number" ? a.conversationIndex : 0;
  const bi = typeof b.conversationIndex === "number" ? b.conversationIndex : 0;
  if (ai !== bi) return ai - bi;
  return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
}

/** Child list derived from parentId — stays correct after backend reparents. */
export function childrenByParentId(lookup: ChatEntryLookup): Map<string | null, LinkedChatEntry[]> {
  const map = new Map<string | null, LinkedChatEntry[]>();
  for (const entry of lookup.getRows()) {
    const list = map.get(entry.parentId) ?? [];
    list.push(entry);
    map.set(entry.parentId, list);
  }
  for (const list of map.values()) {
    list.sort(byConversationIndexAsc);
  }
  return map;
}

export function toLinkedEntries(entries: ChatEntry[], viewLeafId?: string | null): LinkedChatEntry[] {
  const linked: LinkedChatEntry[] = entries.map((entry) => ({ ...entry, isChosen: false }));
  const lookup = lookupFromRows(linked);
  if (viewLeafId && lookup.getById(viewLeafId)) {
    applyChosenPathFromLeaf(viewLeafId, lookup);
  } else if (linked.length > 0) {
    applyChosenPathFromLeaf(defaultLineTipId(lookup), lookup);
  }
  return linked;
}

function lookupFromRows(rows: LinkedChatEntry[]): ChatEntryLookup {
  const byId = new Map(rows.map((entry) => [entry.id, entry]));
  return {
    getById: (id) => byId.get(id),
    getRows: () => rows,
  };
}

function defaultLineTipId(lookup: ChatEntryLookup): string {
  const roots = lookup.getRows().filter((entry) => entry.parentId === null).sort(byConversationIndexAsc);
  if (roots.length === 0) throw new Error("linkedChatEntry: no roots");
  return lineTipIdFrom(lookup, roots[roots.length - 1].id);
}

function lineTipIdFrom(lookup: ChatEntryLookup, startId: string): string {
  const childrenByParent = childrenByParentId(lookup);
  let cursor = startId;
  for (;;) {
    const children = childrenByParent.get(cursor) ?? [];
    if (children.length === 0) return cursor;
    cursor = children[children.length - 1].id;
  }
}

export function patchLinked(existing: LinkedChatEntry, next: ChatEntry): LinkedChatEntry {
  return { ...next, isChosen: existing.isChosen };
}

function siblingsOfEntry(entry: LinkedChatEntry, lookup: ChatEntryLookup): LinkedChatEntry[] {
  return childEntries(lookup, entry.parentId);
}

/** Mark one entry chosen and clear siblings at its fork. */
export function chooseEntry(
  entryId: string,
  lookup: ChatEntryLookup,
  setChosen: (id: string, chosen: boolean) => void,
): void {
  const entry = lookup.getById(entryId);
  if (!entry) throw new Error(`linkedChatEntry.chooseEntry: unknown entry ${entryId}`);
  setChosen(entryId, true);
  for (const sibling of siblingsOfEntry(entry, lookup)) {
    if (sibling.id !== entryId) setChosen(sibling.id, false);
  }
}

function applyChosenPathFromLeaf(leafId: string, lookup: ChatEntryLookup): void {
  const pathIds: string[] = [];
  let cursor: string | null = leafId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (!lookup.getById(cursor)) throw new Error(`linkedChatEntry: unknown leaf ${leafId}`);
    pathIds.push(cursor);
    cursor = lookup.getById(cursor)?.parentId ?? null;
  }
  const setChosen = (id: string, chosen: boolean) => {
    lookup.getById(id)!.isChosen = chosen;
  };
  for (const id of pathIds) {
    chooseEntry(id, lookup, setChosen);
  }
}

/** Branch switch: choose sibling line down to its tip (last child at each fork). */
export function chooseBranchLine(
  startId: string,
  lookup: ChatEntryLookup,
  setChosen: (id: string, chosen: boolean) => void,
): string {
  const childrenByParent = childrenByParentId(lookup);
  const start = lookup.getById(startId);
  if (!start) throw new Error(`linkedChatEntry.chooseBranchLine: unknown entry ${startId}`);
  let cursor: LinkedChatEntry = start;
  for (;;) {
    chooseEntry(cursor.id, lookup, setChosen);
    const children = childrenByParent.get(cursor.id) ?? [];
    if (children.length === 0) return cursor.id;
    const next = children[children.length - 1]!;
    cursor = next;
  }
}

export function rootsOf(lookup: ChatEntryLookup): LinkedChatEntry[] {
  return lookup.getRows().filter((entry) => entry.parentId === null).sort(byConversationIndexAsc);
}

export function childEntries(lookup: ChatEntryLookup, parentId: string | null): LinkedChatEntry[] {
  return childrenByParentId(lookup).get(parentId) ?? [];
}

export function siblingsOf(lookup: ChatEntryLookup, entryId: string): LinkedChatEntry[] {
  const entry = lookup.getById(entryId);
  if (!entry) return [];
  return childEntries(lookup, entry.parentId);
}

/** Root → tip by following isChosen at each fork. */
export function pathFromChosen(lookup: ChatEntryLookup): LinkedChatEntry[] {
  const childrenByParent = childrenByParentId(lookup);
  const roots = childrenByParent.get(null) ?? [];
  const start = roots.find((entry) => entry.isChosen) ?? roots[roots.length - 1];
  if (!start) return [];
  const path: LinkedChatEntry[] = [start];
  let cursor = start;
  for (;;) {
    const next = (childrenByParent.get(cursor.id) ?? []).find((entry) => entry.isChosen);
    if (!next) break;
    path.push(next);
    cursor = next;
  }
  return path;
}

export function activePathTipId(lookup: ChatEntryLookup): string | null {
  const path = pathFromChosen(lookup);
  return path.length > 0 ? path[path.length - 1].id : null;
}

export function extendsChosenPath(lookup: ChatEntryLookup, parentId: string | null): boolean {
  const path = pathFromChosen(lookup);
  if (parentId === null) return path.length === 0;
  return path.some((entry) => entry.id === parentId);
}
