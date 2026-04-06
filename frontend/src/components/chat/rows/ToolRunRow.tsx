import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { approveToolInvocation } from "../../../api/client";
import type { ToolInvocationEntry } from "../../../protocol/chatEntry";
import { notifyError } from "../../../utils/toast";
import { cn } from "@/lib/utils";
import { chatToolOuter } from "../chatMessageLayout";

type ToolRunRowProps = {
  entry: ToolInvocationEntry;
};

const mono = "font-mono";

export function ToolRunRow({ entry }: ToolRunRowProps) {
  const { conversationId: rawConversationId } = useParams();
  const conversationId =
    rawConversationId && rawConversationId !== "new" ? rawConversationId : "";
  const status = stateLabel(entry.state);
  const toolName = entry.toolId || "tool";
  const summary = useMemo(() => summarizeToolOutput(entry), [entry]);
  const [expanded, setExpanded] = useState(false);
  const [approving, setApproving] = useState(false);

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
    <div className={chatToolOuter}>
      <div
        className={cn(
          "rounded-lg border-0 border-l-4 border-l-sky-400 bg-transparent py-2.5 pl-3 pr-3",
          entry.state === "error" && "border-l-red-400 bg-red-500/[0.06]",
        )}
      >
        <button
          type="button"
          className="mb-1.5 flex w-full cursor-pointer flex-wrap items-center gap-2 border-0 bg-transparent p-0 text-left font-inherit text-inherit hover:opacity-90"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse tool details" : "Expand tool details"}
        >
          <span className="text-[11px] font-bold text-muted-foreground">Used</span>
          <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
            {toolName}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px]",
              entry.state === "done"
                ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
                : "border-border text-muted-foreground",
            )}
          >
            {status}
          </span>
          <span className="ml-0.5 text-[10px] opacity-70" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
        </button>

        {expanded ? (
          <div className="mt-2">
            {summary ? (
              <div className="text-[13px] leading-snug text-muted-foreground">{summary}</div>
            ) : null}
            {entry.state === "requested" ? (
              <div className="mt-1.5">
                <button
                  type="button"
                  className="cursor-pointer rounded-sm border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-800 disabled:cursor-default disabled:opacity-60 dark:text-emerald-300"
                  onClick={() => void onApproveClick()}
                  disabled={!conversationId || approving}
                >
                  {approving ? "Allowing..." : "Allow tool"}
                </button>
              </div>
            ) : null}
            <pre
              className={cn(
                mono,
                "mt-1.5 max-h-[200px] overflow-auto whitespace-pre-wrap break-words text-[11px] first:mt-0",
              )}
            >
              {stringifyMaybe(entry.parameters)}
            </pre>
            <pre
              className={cn(
                mono,
                "mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-sm border-0 bg-transparent p-2 text-[11px]",
              )}
            >
              {stringifyMaybe(entry.result)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function summarizeToolOutput(entry: ToolInvocationEntry): string | null {
  if (entry.state === "requested") return "Tool requested.";
  if (entry.state === "running") return "Tool running...";
  if (entry.state === "error") return "Tool failed.";
  if (typeof entry.result === "string" && entry.result.trim().length > 0) return entry.result;
  return "Tool completed.";
}

function stateLabel(state: ToolInvocationEntry["state"]): string {
  if (state === "done") return "completed";
  return state;
}

function stringifyMaybe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
