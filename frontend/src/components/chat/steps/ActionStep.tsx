import { useEffect, useState } from "react";
import { ChevronRight, MessageSquare, Wrench } from "lucide-react";
import type { ThoughtActionEntry } from "@/protocol/chatEntry";
import { ChatThreadIndent } from "../ChatMessageShell";

type ActionStepProps = {
  entry: ThoughtActionEntry;
};

function actionLabel(entry: ThoughtActionEntry): string {
  const toolName = String(entry.toolName || "").trim();
  if (toolName) return `Called ${toolName}`;
  const action = String(entry.action || "").trim();
  if (action === "final_answer") return "Replied to user";
  return "Replied to user";
}

export function ActionStep({ entry }: ActionStepProps) {
  const [open, setOpen] = useState(false);
  const action = String(entry.action || "").trim();
  const meta = action ? `${entry.status} · ${action}` : entry.status;
  const parseResultText = entry.parseResult ? JSON.stringify(entry.parseResult, null, 2) : "";

  useEffect(() => {
    if (entry.status === "failed" || entry.status === "cancelled") {
      setOpen(true);
    }
  }, [entry.status]);

  return (
    <ChatThreadIndent className="py-0">
      <div className="my-0 border-l-2 border-border/60 pl-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={open}
        >
          <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
          {String(entry.toolName || "").trim() ? (
            <Wrench className="h-3 w-3 text-primary" />
          ) : (
            <MessageSquare className="h-3 w-3 text-primary" />
          )}
          <span className="font-medium">Action</span>
          <span className="opacity-60">· {meta}</span>
          <span className="opacity-60">· {actionLabel(entry)}</span>
        </button>
        {open && parseResultText ? (
          <pre className="mt-1.5 ml-4 whitespace-pre-wrap break-words rounded border border-border/50 bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-foreground/90">
            {parseResultText}
          </pre>
        ) : null}
      </div>
    </ChatThreadIndent>
  );
}
