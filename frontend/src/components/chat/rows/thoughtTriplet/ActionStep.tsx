import { useMemo } from "react";
import type { PlannerLlmStreamEntry, ThoughtActionEntry, TitleLlmStreamEntry } from "@/protocol/chatEntry";
import { displayStatus } from "./meta";
import { ReadOnlySection } from "./ReadOnlySection";

export function ActionStep({
  actionEntry,
  stream,
}: {
  actionEntry: ThoughtActionEntry | null;
  stream: PlannerLlmStreamEntry | TitleLlmStreamEntry;
}) {
  const summary = String(actionEntry?.summary || "").trim();
  const action = String(actionEntry?.action || "").trim();
  const error = String(actionEntry?.error || stream.error || "").trim();
  const parseJson = useMemo(() => {
    if (actionEntry?.parseResult) return JSON.stringify(actionEntry.parseResult, null, 2);
    if (stream.decision) return JSON.stringify(stream.decision, null, 2);
    return "";
  }, [actionEntry?.parseResult, stream.decision]);
  const statusLabel = displayStatus(actionEntry?.status ?? stream.status ?? "running");

  return (
    <div className="mt-1.5 ml-1 space-y-2 text-xs">
      <div className="text-[10px] text-muted-foreground">
        {[statusLabel ? `status: ${statusLabel}` : "", action ? `action: ${action}` : "", actionEntry?.toolName ? `tool: ${actionEntry.toolName}` : ""]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <ReadOnlySection label="Summary" value={summary} />
      <ReadOnlySection label="Decision JSON" value={parseJson} />
      {(actionEntry?.status === "failed" ||
        actionEntry?.status === "cancelled" ||
        stream.status === "failed" ||
        stream.status === "cancelled") &&
      error ? (
        <ReadOnlySection label="Error" value={error} danger />
      ) : null}
    </div>
  );
}
