import type { ChatEntry } from "@/protocol/chatEntry";

export function byConversationIndexAsc(a: ChatEntry, b: ChatEntry): number {
  const ai = typeof a.conversationIndex === "number" ? a.conversationIndex : 0;
  const bi = typeof b.conversationIndex === "number" ? b.conversationIndex : 0;
  if (ai !== bi) return ai - bi;
  return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
}

export function buildChildrenByParent(entries: ChatEntry[]): Map<string | null, ChatEntry[]> {
  const map = new Map<string | null, ChatEntry[]>();
  for (const row of entries) {
    const list = map.get(row.parentId) ?? [];
    list.push(row);
    map.set(row.parentId, list);
  }
  for (const list of map.values()) {
    list.sort(byConversationIndexAsc);
  }
  return map;
}

/** Last tip viewed on each fork-sibling line (key = sibling entry id at the fork). */
export type BranchTipMemory = Map<string, string>;

export function deepestDescendantId(start: string, childrenByParent: Map<string | null, ChatEntry[]>): string {
  let cursor = start;
  for (;;) {
    const children = childrenByParent.get(cursor) ?? [];
    if (children.length === 0) return cursor;
    cursor = children[children.length - 1].id;
  }
}

function resolvePathTipId(entries: ChatEntry[], viewAnchorId: string | null): string | null {
  if (entries.length === 0) return null;
  const childrenByParent = buildChildrenByParent(entries);
  const byId = new Set(entries.map((entry) => entry.id));

  if (viewAnchorId && byId.has(viewAnchorId)) {
    return deepestDescendantId(viewAnchorId, childrenByParent);
  }

  const roots = childrenByParent.get(null) ?? [];
  if (roots.length === 0) return null;
  return deepestDescendantId(roots[roots.length - 1].id, childrenByParent);
}

/** Root-to-tip path — same line the chat renders. */
export function buildActivePath(entries: ChatEntry[], viewAnchorId: string | null): ChatEntry[] {
  const tipId = resolvePathTipId(entries, viewAnchorId);
  if (!tipId) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: ChatEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | null = tipId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const entry = byId.get(cursor);
    if (!entry) break;
    path.push(entry);
    cursor = entry.parentId;
  }
  path.reverse();
  return path;
}

/** Remember the tip for every fork-sibling on the path to `leafId`. */
export function rememberBranchTips(entries: ChatEntry[], leafId: string, memory: BranchTipMemory): void {
  const childrenByParent = buildChildrenByParent(entries);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let cursor: string | null = leafId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const entry = byId.get(cursor);
    if (!entry) break;
    const siblings = childrenByParent.get(entry.parentId) ?? [];
    if (siblings.length > 1) memory.set(cursor, leafId);
    cursor = entry.parentId;
  }
}

/** Last selected tip on a branch line, or deepest descendant if never visited. */
export function resolveBranchLeaf(branchEntryId: string, entries: ChatEntry[], memory: BranchTipMemory): string {
  const remembered = memory.get(branchEntryId);
  if (remembered && entries.some((entry) => entry.id === remembered)) return remembered;
  return deepestDescendantId(branchEntryId, buildChildrenByParent(entries));
}

/** New entry extends the visible path when its parent is already on that path. */
export function viewAnchorAfterAppend(
  entries: ChatEntry[],
  currentAnchor: string | null,
  entry: ChatEntry,
): string | null {
  const path = buildActivePath(entries, currentAnchor);
  const onPath = entry.parentId == null ? path.length === 0 : path.some((row) => row.id === entry.parentId);
  if (!onPath) return currentAnchor;
  return entry.id;
}
