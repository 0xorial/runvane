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
