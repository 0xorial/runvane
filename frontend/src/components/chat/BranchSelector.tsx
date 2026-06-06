import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ChatEntry } from "@/protocol/chatEntry";
import { useChatSessionContext } from "@/hooks/chatSessionContext";
import { siblingsOf } from "@/lib/linkedChatEntry";
import { notifyError } from "@/utils/toast";

function siblingIndexForTip(siblings: ChatEntry[], pathTipId: string | null, parentOf: (id: string) => ChatEntry | undefined): number {
  if (!pathTipId || siblings.length === 0) return -1;
  const siblingIds = new Set(siblings.map((row) => row.id));
  let cursor: string | null = pathTipId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (siblingIds.has(cursor)) return siblings.findIndex((row) => row.id === cursor);
    seen.add(cursor);
    cursor = parentOf(cursor)?.parentId ?? null;
  }
  return -1;
}

export function useSiblingBranches(entryId: string | null | undefined) {
  const { sessionStore, activePathEntries, switchToBranch } = useChatSessionContext();
  const [switching, setSwitching] = useState(false);

  const pathTipId = activePathEntries.length > 0 ? activePathEntries[activePathEntries.length - 1].id : null;
  const siblings = entryId ? siblingsOf(sessionStore, entryId) : [];
  const activeIndex = siblingIndexForTip(siblings, pathTipId, (id) => sessionStore.getById(id)?.get());
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
