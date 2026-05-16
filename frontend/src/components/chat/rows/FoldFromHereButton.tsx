import { useMemo, useState } from "react";
import { Layers } from "lucide-react";
import { summarizeConversation } from "@/api/client";
import { useChatSessionContext } from "@/hooks/chatSessionContext";
import { notifyError } from "@/utils/toast";

/**
 * "Fold from this message onward" affordance, shown inline on chat rows.
 * Folds the active-chain tail starting at `entryId` (inclusive) into a
 * `checkpoint-summary` entry whose parent is the entry preceding
 * `entryId`. The original tail (including this entry) is preserved on a
 * sibling branch and reachable via the BranchSelector on the new summary.
 *
 * Hidden when:
 *  - entry is not on the active chain, or
 *  - entry is the first entry of the chain (no parent to anchor the
 *    summary branch onto).
 */
export function FoldFromHereButton({
  conversationId,
  entryId,
}: {
  conversationId: string;
  entryId: string;
}) {
  const { activePathEntries } = useChatSessionContext();
  const [submitting, setSubmitting] = useState(false);

  const canFold = useMemo(() => {
    const idx = activePathEntries.findIndex((e) => e.id === entryId);
    return idx > 0;
  }, [activePathEntries, entryId]);

  if (!canFold) return null;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await summarizeConversation(conversationId, { firstEntryToSummarize: entryId });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notifyError(`Failed to fold: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      onClick={() => void submit()}
      disabled={submitting}
      title="Fold this message and everything after it into a summary"
      aria-label="Fold this message and everything after it"
    >
      <Layers className="h-3 w-3" strokeWidth={1.75} />
      {submitting ? "Folding…" : "Fold"}
    </button>
  );
}
