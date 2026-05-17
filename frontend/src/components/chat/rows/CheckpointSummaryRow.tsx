import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Layers, GitBranch } from "lucide-react";
import type { CheckpointSummaryEntry } from "../../../protocol/chatEntry";
import { CopyButton } from "@/components/ui/CopyButton";
import { formatExactChatTime, formatRelativeChatTime } from "../../../utils/formatRelativeChatTime";
import { ChatMessageShell } from "../ChatMessageShell";
import { BranchSelector, buildChildrenByParent, deepestDescendantId } from "../BranchSelector";
import { useChatSessionContext } from "@/hooks/chatSessionContext";
import { notifyError } from "@/utils/toast";

const proseChat =
  "prose prose-sm max-w-none leading-relaxed text-foreground dark:prose-invert prose-p:my-2 prose-p:first:mt-0 prose-p:last:mb-0 prose-headings:my-2 prose-pre:my-2";

/**
 * Renders a `checkpoint-summary` entry — a fold of N prior turns into a
 * single summary on a sibling branch. The original tail remains accessible
 * via the BranchSelector (sibling at the divergence point), so this row
 * is intentionally compact: it announces the fold, shows the summary, and
 * exposes the branch switcher for users who want to retrieve the originals.
 */
function ViewOriginalButton({ fromEntryId }: { fromEntryId: string }) {
  const { allEntries, setActiveLeaf } = useChatSessionContext();
  const [switching, setSwitching] = useState(false);

  const originalLeafId = useMemo(() => {
    const all = allEntries.map((r$) => r$.get());
    const childrenByParent = buildChildrenByParent(all);
    return childrenByParent.has(fromEntryId) ? deepestDescendantId(fromEntryId, childrenByParent) : null;
  }, [allEntries, fromEntryId]);

  if (!originalLeafId) return null;

  return (
    <button
      type="button"
      disabled={switching}
      onClick={(e) => {
        e.stopPropagation();
        setSwitching(true);
        setActiveLeaf(originalLeafId)
          .catch((err) => notifyError(`Failed to switch branch: ${err instanceof Error ? err.message : String(err)}`))
          .finally(() => setSwitching(false));
      }}
      className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
    >
      <GitBranch className="h-3 w-3" strokeWidth={1.75} />
      View original
    </button>
  );
}

export function CheckpointSummaryRow({ entry }: { entry: CheckpointSummaryEntry }) {
  const relativeTime = formatRelativeChatTime(entry.createdAt);
  const exactTime = formatExactChatTime(entry.createdAt);
  return (
    <ChatMessageShell
      role="agent"
      badge={
        <div className="flex items-center gap-1">
          <span className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Layers className="h-3 w-3" strokeWidth={1.75} />
            folded
          </span>
          <ViewOriginalButton fromEntryId={entry.summarizedRange.fromEntryId} />
          <BranchSelector entryId={entry.id} />
          {relativeTime ? (
            <span
              className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground"
              title={exactTime || undefined}
            >
              {relativeTime}
            </span>
          ) : null}
          {entry.summaryText ? <CopyButton value={entry.summaryText} title="Copy summary" /> : null}
        </div>
      }
    >
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Summary of earlier turns
        </div>
        {entry.summaryText ? (
          <div className={proseChat}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
              }}
            >
              {entry.summaryText}
            </ReactMarkdown>
          </div>
        ) : null}
      </div>
    </ChatMessageShell>
  );
}
