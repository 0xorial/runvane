import { useState } from "react";
import { ChevronRight, FileText } from "lucide-react";
import type { ThoughtPrepareEntry } from "@/protocol/chatEntry";
import { ChatThreadIndent } from "../ChatMessageShell";

type PreparedContextStepProps = {
  entry: ThoughtPrepareEntry;
};

export function PreparedContextStep({ entry }: PreparedContextStepProps) {
  const [open, setOpen] = useState(false);
  const model = String(entry.llmModel || "").trim();
  const meta = model ? `completed · ${model}` : "completed";
  const requestText = String(entry.requestText || "").trim();

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
          <FileText className="h-3 w-3 text-muted-foreground/70" />
          <span className="font-medium">Prepared context</span>
          <span className="opacity-60">· {meta}</span>
        </button>
        {open && requestText ? (
          <div className="mt-1.5 ml-4 space-y-0.5 text-xs">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Prompt</div>
            <pre className="whitespace-pre-wrap break-words rounded border border-border/50 bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-foreground/90">
              {requestText}
            </pre>
          </div>
        ) : null}
      </div>
    </ChatThreadIndent>
  );
}
