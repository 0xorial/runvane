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

/** Child list derived from parentId. Includes side-lane entries — rendering only. */
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

/**
 * Branch-semantics child list: spine entries only. Side-lane entries (title/
 * categorize/params/guardrail/summary thoughts) hang off their anchor for
 * display but are NOT alternatives to it — every fork count, chosen-path walk,
 * and leaf resolution uses this map so side thoughts can never look like
 * branches or hijack the view tip.
 */
export function spineChildrenByParentId(lookup: ChatEntryLookup): Map<string | null, LinkedChatEntry[]> {
  const map = new Map<string | null, LinkedChatEntry[]>();
  for (const entry of lookup.getRows()) {
    if (entry.isSide) continue;
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
  const roots = lookup
    .getRows()
    .filter((entry) => entry.parentId === null && !entry.isSide)
    .sort(byConversationIndexAsc);
  if (roots.length === 0) throw new Error("linkedChatEntry: no roots");
  return lineTipIdFrom(lookup, roots[roots.length - 1].id);
}

function lineTipIdFrom(lookup: ChatEntryLookup, startId: string): string {
  const childrenByParent = spineChildrenByParentId(lookup);
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

/** Branch switch: choose sibling line down to its tip (last spine child at each fork). */
export function chooseBranchLine(
  startId: string,
  lookup: ChatEntryLookup,
  setChosen: (id: string, chosen: boolean) => void,
): string {
  const childrenByParent = spineChildrenByParentId(lookup);
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
  return lookup
    .getRows()
    .filter((entry) => entry.parentId === null && !entry.isSide)
    .sort(byConversationIndexAsc);
}

/** Spine children only — branch semantics (fork counting, selectors, walks). */
export function childEntries(lookup: ChatEntryLookup, parentId: string | null): LinkedChatEntry[] {
  return spineChildrenByParentId(lookup).get(parentId) ?? [];
}

export function siblingsOf(lookup: ChatEntryLookup, entryId: string): LinkedChatEntry[] {
  const entry = lookup.getById(entryId);
  if (!entry) return [];
  // A side-lane entry hangs off its anchor for display only — it is not an
  // alternative at that fork, so it must not inherit (or page) the anchor's
  // spine branches.
  if (entry.isSide) return [];
  return childEntries(lookup, entry.parentId);
}

/**
 * Root → tip by following isChosen at each spine fork, with each spine
 * entry's side-lane thoughts (title/categorize/params/guardrail/summaries)
 * interleaved right after their anchor so they render in place without
 * participating in branching.
 */
export function pathFromChosen(lookup: ChatEntryLookup): LinkedChatEntry[] {
  const spineChildren = spineChildrenByParentId(lookup);
  const roots = spineChildren.get(null) ?? [];
  const start = roots.find((entry) => entry.isChosen) ?? roots[roots.length - 1];
  if (!start) return [];
  const spine: LinkedChatEntry[] = [start];
  let cursor = start;
  for (;;) {
    const next = (spineChildren.get(cursor.id) ?? []).find((entry) => entry.isChosen);
    if (!next) break;
    spine.push(next);
    cursor = next;
  }
  return interleaveSideLane(lookup, spine);
}

/** Splice each spine entry's side segments (in index order, each walked linearly) after it. */
function interleaveSideLane(lookup: ChatEntryLookup, spine: LinkedChatEntry[]): LinkedChatEntry[] {
  const allChildren = childrenByParentId(lookup);
  const sideChildrenOf = (id: string): LinkedChatEntry[] =>
    (allChildren.get(id) ?? []).filter((entry) => entry.isSide);
  const out: LinkedChatEntry[] = [];
  for (const entry of spine) {
    out.push(entry);
    for (const sideRoot of sideChildrenOf(entry.id)) {
      out.push(sideRoot);
      let cursor = sideRoot;
      for (;;) {
        const kids = sideChildrenOf(cursor.id);
        if (kids.length === 0) break;
        for (const kid of kids) out.push(kid);
        cursor = kids[kids.length - 1];
      }
    }
  }
  return out;
}

export function activePathTipId(lookup: ChatEntryLookup): string | null {
  const path = pathFromChosen(lookup);
  for (let i = path.length - 1; i >= 0; i--) {
    if (!path[i].isSide) return path[i].id;
  }
  return null;
}

export function extendsChosenPath(lookup: ChatEntryLookup, parentId: string | null): boolean {
  const path = pathFromChosen(lookup);
  if (parentId === null) return path.length === 0;
  return path.some((entry) => entry.id === parentId);
}

/** Mirror backend resolveDefaultViewLeaf: walk from anchor, latest SPINE child at each fork. */
export function resolveViewTipFromAnchor(lookup: ChatEntryLookup, anchorId: string | null): string | null {
  const startId =
    anchorId && lookup.getById(anchorId)
      ? anchorId
      : (() => {
          const roots = childEntries(lookup, null);
          return roots.length > 0 ? roots[roots.length - 1].id : null;
        })();
  if (!startId) return null;
  return walkToLatestLeaf(lookup, startId);
}

function walkToLatestLeaf(lookup: ChatEntryLookup, startId: string): string {
  let cursor = startId;
  const visited = new Set<string>();
  while (!visited.has(cursor)) {
    visited.add(cursor);
    const children = childEntries(lookup, cursor);
    if (children.length === 0) return cursor;
    cursor = children[children.length - 1].id;
  }
  return cursor;
}
