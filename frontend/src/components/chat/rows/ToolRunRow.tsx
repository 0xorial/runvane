import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
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
import type { ToolInvocationEntry, ToolState } from "../../../../../backend/src/contracts/chatEntry";
import { notifyError } from "../../../utils/toast";
import { cn } from "@/lib/utils";
import { ChatThreadIndent } from "../ChatMessageShell";

type ToolRunRowProps = {
  entry: ToolInvocationEntry;
};

function statePresentation(state: ToolState, guardrailReason: string | null) {
  switch (state) {
    case "requested":
      return {
        StatusIcon: ShieldQuestion,
        statusLabel: guardrailReason ? "Guardrail flagged" : "Needs approval",
        statusClass: "text-warning",
        borderClass: "border-warning/40 bg-warning/5",
      } as const;
    case "running":
      return {
        StatusIcon: Loader2,
        statusLabel: "Running",
        statusClass: "text-primary animate-spin",
        borderClass: "bg-secondary/50",
      } as const;
    case "done":
      return {
        StatusIcon: CheckCircle2,
        statusLabel: "Done",
        statusClass: "text-success",
        borderClass: "bg-secondary/50",
      } as const;
    case "error":
      return {
        StatusIcon: XCircle,
        statusLabel: "Failed",
        statusClass: "text-destructive",
        borderClass: "bg-secondary/50",
      } as const;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function ToolRunRow({ entry }: ToolRunRowProps) {
  const { conversationId: rawConversationId } = useParams();
  const conversationId = rawConversationId && rawConversationId !== "new" ? rawConversationId : "";
  const toolName = entry.toolId || "tool";
  const [expanded, setExpanded] = useState(entry.state === "requested");
  const [approving, setApproving] = useState(false);

  const guardrailReason = useMemo(() => {
    const err = entry.result?.error ?? null;
    if (!err) return null;
    const prefix = "Guardrail flagged: ";
    return err.startsWith(prefix) ? err.slice(prefix.length) : null;
  }, [entry.result]);

  const { StatusIcon, statusLabel, statusClass, borderClass } = useMemo(
    () => statePresentation(entry.state, guardrailReason),
    [entry.state, guardrailReason],
  );

  async function onApproveClick() {
    if (!conversationId || approving) return;
    setApproving(true);
    try {
      await approveToolInvocation(conversationId, entry.id);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to approve tool");
    } finally {
      setApproving(false);
    }
  }

  return (
    <ChatThreadIndent>
      <div className={cn("overflow-hidden rounded-md border", borderClass)}>
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
          <span className={cn("text-[10px] font-medium", entry.state === "requested" ? "text-warning" : "text-muted-foreground")}>
            {statusLabel}
          </span>
        </button>

        {expanded && (
          <div className="animate-slide-in space-y-2 border-t px-3 py-2">
            {guardrailReason && (
              <div className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span><span className="font-semibold">Guardrail: </span>{guardrailReason}</span>
              </div>
            )}
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Arguments</span>
              <pre className="mt-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground">
                {stringifyMaybe(entry.parameters)}
              </pre>
            </div>
            {entry.result?.output != null && stringifyMaybe(entry.result.output).length > 0 && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Result</span>
                <pre className="scrollbar-thin mt-1 max-h-40 overflow-y-auto overflow-x-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground">
                  {stringifyMaybe(entry.result.output)}
                </pre>
              </div>
            )}
            {entry.state === "requested" && (
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
                  {approving ? "Approving…" : "Approve & run"}
                </button>
              </div>
            )}
          </div>
        )}
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
