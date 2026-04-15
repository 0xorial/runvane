import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  ShieldCheck,
  ShieldQuestion,
  Wrench,
  XCircle,
} from "lucide-react";
import { approveToolInvocation } from "../../../api/client";
import type { ToolInvocationEntry } from "../../../protocol/chatEntry";
import { notifyError } from "../../../utils/toast";
import { cn } from "@/lib/utils";
import { ChatThreadIndent } from "../ChatMessageShell";

type ToolRunRowProps = {
  entry: ToolInvocationEntry;
};

/** Mirrors frontend2/src/components/chat/ToolCallBlock.tsx */
export function ToolRunRow({ entry }: ToolRunRowProps) {
  const { conversationId: rawConversationId } = useParams();
  const conversationId = rawConversationId && rawConversationId !== "new" ? rawConversationId : "";
  const toolName = entry.toolId || "tool";
  const [expanded, setExpanded] = useState(entry.state === "requested");
  const [approving, setApproving] = useState(false);

  const isAwaiting = entry.state === "requested";
  const isRunning = entry.state === "running";
  const isDone = entry.state === "done";
  const isError = entry.state === "error";

  const { StatusIcon, statusLabel, statusClass } = useMemo(() => {
    if (isAwaiting) {
      return {
        StatusIcon: ShieldQuestion,
        statusLabel: "Needs approval",
        statusClass: "text-warning",
      } as const;
    }
    if (isRunning) {
      return {
        StatusIcon: Loader2,
        statusLabel: "Running",
        statusClass: "text-primary animate-spin",
      } as const;
    }
    if (isError) {
      return {
        StatusIcon: XCircle,
        statusLabel: "Failed",
        statusClass: "text-destructive",
      } as const;
    }
    return {
      StatusIcon: CheckCircle2,
      statusLabel: "",
      statusClass: "text-success",
    } as const;
  }, [isAwaiting, isRunning, isError]);

  async function onApproveClick() {
    if (!conversationId || approving) return;
    setApproving(true);
    try {
      await approveToolInvocation(conversationId, entry.id);
      window.dispatchEvent(new Event("runvane:refresh-chat"));
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to approve tool");
    } finally {
      setApproving(false);
    }
  }

  return (
    <ChatThreadIndent>
      <div
        className={cn(
          "overflow-hidden rounded-md border",
          isAwaiting ? "border-warning/40 bg-warning/5" : "bg-secondary/50",
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-secondary"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <Wrench className="h-3 w-3 shrink-0 text-primary" />
          <span className="font-mono font-medium text-foreground">{toolName}</span>
          <StatusIcon className={cn("ml-auto h-3 w-3 shrink-0", statusClass)} />
          <span className={cn("text-[10px] font-medium", isAwaiting ? "text-warning" : "text-muted-foreground")}>
            {isAwaiting || isRunning || isError ? statusLabel : isDone ? "Done" : ""}
          </span>
        </button>

        {expanded ? (
          <div className="animate-slide-in space-y-2 border-t px-3 py-2">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Arguments</span>
              <pre className="mt-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground">
                {stringifyMaybe(entry.parameters)}
              </pre>
            </div>
            {entry.result !== undefined && entry.result !== null && stringifyMaybe(entry.result).length > 0 ? (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Result</span>
                <pre className="scrollbar-thin mt-1 max-h-40 overflow-y-auto overflow-x-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground">
                  {stringifyMaybe(entry.result)}
                </pre>
              </div>
            ) : null}
            {isAwaiting ? (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onApproveClick();
                  }}
                  disabled={!conversationId || approving}
                  className="flex items-center gap-1.5 rounded-md bg-success/15 px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/25"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {approving ? "Approving…" : "Approve"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </ChatThreadIndent>
  );
}

function stringifyMaybe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
