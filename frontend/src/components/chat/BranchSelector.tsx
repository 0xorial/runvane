import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ChatEntry } from "@/protocol/chatEntry";
import { useChatSessionContext } from "@/hooks/chatSessionContext";
import { notifyError } from "@/utils/toast";

function byConversationIndexAsc(a: ChatEntry, b: ChatEntry): number {
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

export function useSiblingBranches(entryId: string | null | undefined) {
  const { allEntries, setActiveLeaf } = useChatSessionContext();
  const [switching, setSwitching] = useState(false);

  const sortedAll = useMemo(
    () => allEntries.map((row$) => row$.get()).sort(byConversationIndexAsc),
    [allEntries],
  );
  const childrenByParent = useMemo(() => buildChildrenByParent(sortedAll), [sortedAll]);
  const byId = useMemo(() => new Map(sortedAll.map((e) => [e.id, e])), [sortedAll]);

  const self = entryId ? byId.get(entryId) ?? null : null;
  const siblings = self ? childrenByParent.get(self.parentId) ?? [] : [];
  const activeIndex = self ? siblings.findIndex((row) => row.id === self.id) : -1;
  const hasBranches = siblings.length > 1 && activeIndex >= 0;

  async function switchByOffset(offset: -1 | 1) {
    if (!hasBranches || switching) return;
    const nextIndex = (activeIndex + offset + siblings.length) % siblings.length;
    const sibling = siblings[nextIndex];
    if (!sibling) return;
    setSwitching(true);
    try {
      await setActiveLeaf(deepestDescendantId(sibling.id, childrenByParent));
    } catch (e) {
      notifyError(`Failed to switch branch: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSwitching(false);
    }
  }

  return { siblings, activeIndex, hasBranches, switching, switchByOffset };
}

export function BranchBadge({ entryId }: { entryId: string | null | undefined }) {
  const { siblings, activeIndex, hasBranches } = useSiblingBranches(entryId);
  if (!hasBranches) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-secondary/60 px-1 py-0.5 font-mono text-[9px] tabular-nums text-muted-foreground">
      {activeIndex + 1}/{siblings.length}
    </span>
  );
}

export function BranchSelector({ entryId }: { entryId: string | null | undefined }) {
  const { siblings, activeIndex, hasBranches, switching, switchByOffset } = useSiblingBranches(entryId);
  if (!hasBranches) return null;
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded bg-secondary/60 px-1 py-0.5 text-[10px] text-muted-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={switching}
        onClick={() => {
          void switchByOffset(-1);
        }}
        className="transition-colors hover:text-foreground disabled:opacity-50"
        aria-label="Previous branch"
      >
        <ChevronLeft className="h-3 w-3" />
      </button>
      <span className="font-mono tabular-nums">
        {activeIndex + 1}/{siblings.length}
      </span>
      <button
        type="button"
        disabled={switching}
        onClick={() => {
          void switchByOffset(1);
        }}
        className="transition-colors hover:text-foreground disabled:opacity-50"
        aria-label="Next branch"
      >
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}
