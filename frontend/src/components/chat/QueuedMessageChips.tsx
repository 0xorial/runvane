import { Clock, X } from "lucide-react";
import type { PendingMessage } from "@/lib/chatSessionStore";

type QueuedMessageChipsProps = {
  messages: PendingMessage[];
  onCancel: (clientRequestId: string) => void;
};

/**
 * Pending (enqueued) messages shown above the composer. Each will post
 * automatically once the active run finishes; the ✕ removes it before then.
 */
export function QueuedMessageChips({ messages, onCancel }: QueuedMessageChipsProps) {
  if (messages.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Clock className="h-3 w-3" strokeWidth={2} />
        Queued
        <span className="tabular-nums opacity-70">· {messages.length}</span>
      </span>
      {messages.map((m) => (
        <span
          key={m.clientRequestId}
          className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-border/70 bg-secondary/50 py-0.5 pl-2 pr-1 text-[11px] text-foreground/80"
          title={m.text}
        >
          <span className="truncate">{m.text}</span>
          <button
            type="button"
            onClick={() => onCancel(m.clientRequestId)}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
            aria-label="Cancel queued message"
          >
            <X className="h-3 w-3" strokeWidth={2.25} />
          </button>
        </span>
      ))}
    </div>
  );
}
