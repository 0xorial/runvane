import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ChatEntry } from "@/protocol/chatEntry";
import { useChatSessionContext } from "@/hooks/chatSessionContext";
import { buildChildrenByParent, byConversationIndexAsc } from "@/lib/chatTree";
import { notifyError } from "@/utils/toast";

export { buildChildrenByParent, deepestDescendantId } from "@/lib/chatTree";

function siblingIndexForTip(
  siblings: ChatEntry[],
  byId: Map<string, ChatEntry>,
  pathTipId: string | null,
): number {
  if (!pathTipId || siblings.length === 0) return -1;
  const siblingIds = new Set(siblings.map((row) => row.id));
  let cursor: string | null = pathTipId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (siblingIds.has(cursor)) return siblings.findIndex((row) => row.id === cursor);
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return -1;
}

export function useSiblingBranches(entryId: string | null | undefined) {
  const { allEntries, activePathEntries, switchToBranch } = useChatSessionContext();
  const [switching, setSwitching] = useState(false);

  const sortedAll = useMemo(
    () => allEntries.map((row$) => row$.get()).sort(byConversationIndexAsc),
    [allEntries],
  );
  const childrenByParent = useMemo(() => buildChildrenByParent(sortedAll), [sortedAll]);
  const byId = useMemo(() => new Map(sortedAll.map((e) => [e.id, e])), [sortedAll]);
  const pathTipId = activePathEntries.length > 0 ? activePathEntries[activePathEntries.length - 1].id : null;

  const self = entryId ? byId.get(entryId) ?? null : null;
  const siblings = self ? childrenByParent.get(self.parentId) ?? [] : [];
  const activeIndex = siblingIndexForTip(siblings, byId, pathTipId);
  const hasBranches = siblings.length > 1 && activeIndex >= 0;

  async function switchByOffset(offset: -1 | 1) {
    if (!hasBranches || switching) return;
    const nextIndex = (activeIndex + offset + siblings.length) % siblings.length;
    const sibling = siblings[nextIndex];
    if (!sibling) return;
    setSwitching(true);
    try {
      await switchToBranch(sibling.id);
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
