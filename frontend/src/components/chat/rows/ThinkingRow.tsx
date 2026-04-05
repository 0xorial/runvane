import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration, parseDbTimestampMs } from "../../../utils/formatDuration";
import type { PlannerLlmStreamEntry } from "../../../protocol/chatEntry";
import { cx } from "../../../utils/cx";
import styles from "./ThinkingRow.module.css";

type ThinkingRowProps = {
  entry: PlannerLlmStreamEntry;
};

function startTimestampMs(messageCreatedAt: string): number {
  if (!messageCreatedAt) return Date.now();
  const parsed = parseDbTimestampMs(messageCreatedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isDone(entry: PlannerLlmStreamEntry): boolean {
  return Number.isFinite(Number(entry.thoughtMs));
}

export function ThinkingRow({ entry }: ThinkingRowProps) {
  const done = isDone(entry);
  const failed = entry.failed === true;
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(0);
  const detailsWrapRef = useRef<HTMLDivElement | null>(null);
  const [autoscrollEnabled, setAutoscrollEnabled] = useState(false);

  const startedAt = useMemo(() => startTimestampMs(entry.createdAt), [entry.createdAt]);
  const requestText = String(entry.llmRequest || "").trim();
  const responseText = String(entry.llmResponse || "").trim();
  const hasDetails = requestText.length > 0 || responseText.length > 0;

  useEffect(() => {
    if (done) return undefined;
    const id = window.setInterval(() => setTick((x) => x + 1), 100);
    return () => window.clearInterval(id);
  }, [done]);

  useEffect(() => {
    if (expanded) setAutoscrollEnabled(true);
  }, [expanded]);

  useEffect(() => {
    if (done && !failed) setExpanded(false);
  }, [done, failed]);

  useEffect(() => {
    if (failed) setExpanded(true);
  }, [failed]);

  useEffect(() => {
    if (!expanded || !autoscrollEnabled) return;
    const el = detailsWrapRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [expanded, autoscrollEnabled, requestText, responseText]);

  function onAutoscrollToggle() {
    const el = detailsWrapRef.current;
    const next = !autoscrollEnabled;
    setAutoscrollEnabled(next);
    if (!el || !next) return;
    el.scrollTop = el.scrollHeight;
  }

  void tick;
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const durationMs = Number.isFinite(Number(entry.thoughtMs))
    ? Number(entry.thoughtMs)
    : elapsedMs;
  const title = done
    ? failed
      ? `Thought failed after ${formatDuration(durationMs)}`
      : `Thought for ${formatDuration(durationMs)}`
    : `Thinking… ${formatDuration(elapsedMs)}`;

  return (
    <div className={cx(styles.root, done && styles.done, !done && styles.live)}>
      <div className={styles.thoughtBox}>
        {hasDetails ? (
          <button
            type="button"
            className={cx(styles.title, styles.titleClickable, failed && styles.titleError)}
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Hide thought details" : "Show thought details"}
          >
            <span>{title}</span>
            <span className={cx(styles.toggle, styles.toggleInline)} aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
          </button>
        ) : (
          <div className={cx(styles.title, failed && styles.titleError)}>{title}</div>
        )}
        {failed ? (
          <div className={styles.errorHint}>
            Request failed. See details below.
          </div>
        ) : null}
        {expanded && hasDetails ? (
          <div className={styles.detailsWrap} ref={detailsWrapRef}>
            <button
              type="button"
              className={cx(styles.autoscrollBtn, autoscrollEnabled && styles.autoscrollBtnActive)}
              onClick={onAutoscrollToggle}
              aria-label="Toggle autoscroll"
              title={autoscrollEnabled ? "Autoscroll on" : "Autoscroll off"}
              aria-pressed={autoscrollEnabled}
            >
              <span className={styles.autoscrollIcon} aria-hidden="true">
                ↓
              </span>
              <span className={styles.autoscrollDash} aria-hidden="true">
                -
              </span>
            </button>
            <div className={styles.streamBlock}>
              {requestText ? (
                <>
                  <div className={styles.sectionLabel}>Request</div>
                  <pre className={cx(styles.details, styles.mono, styles.streamContent)}>
                    {requestText}
                  </pre>
                </>
              ) : null}
              {responseText ? (
                <>
                  <div className={styles.sectionLabel}>{failed ? "Error" : "Response"}</div>
                  <pre className={cx(styles.details, styles.mono, styles.streamContent)}>
                    {responseText}
                  </pre>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
