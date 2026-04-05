import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { approveToolInvocation } from "../../../api/client";
import type { ToolInvocationEntry } from "../../../protocol/chatEntry";
import { notifyError } from "../../../utils/toast";
import { cx } from "../../../utils/cx";
import rowStyles from "../ChatMessageRow.module.css";
import styles from "./ToolRunRow.module.css";

type ToolRunRowProps = {
  entry: ToolInvocationEntry;
};

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
    <div className={cx(rowStyles.msg, rowStyles.assistant, rowStyles.toolRow)}>
      <div className={cx(styles.runToolRun, entry.state === "error" && styles.runToolRunError)}>
        <button
          type="button"
          className={styles.headButton}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse tool details" : "Expand tool details"}
        >
          <span className={styles.usedLabel}>Used</span>
          <span className={styles.toolNamePill}>{toolName}</span>
          <span
            className={cx(
              styles.pill,
              entry.state === "done" ? styles.pillOk : styles.pillNeutral,
            )}
          >
            {status}
          </span>
          <span className={styles.chevron} aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
        </button>

        {expanded ? (
          <div className={styles.toolBody}>
            {summary ? <div className={styles.toolSummary}>{summary}</div> : null}
            {entry.state === "requested" ? (
              <div className={styles.toolActions}>
                <button
                  type="button"
                  className={styles.approveBtn}
                  onClick={() => void onApproveClick()}
                  disabled={!conversationId || approving}
                >
                  {approving ? "Allowing..." : "Allow tool"}
                </button>
              </div>
            ) : null}
            <pre className={cx(styles.pre, styles.mono)}>{stringifyMaybe(entry.parameters)}</pre>
            <pre className={cx(styles.pre, styles.preOut, styles.mono)}>{stringifyMaybe(entry.result)}</pre>
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
