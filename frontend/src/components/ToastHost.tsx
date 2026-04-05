import { useEffect, useMemo, useState } from "react";
import { ignoreToast, subscribeToastStore } from "../utils/toast";
import type { ToastItem } from "../utils/toast";
import { cx } from "../utils/cx";
import styles from "./ToastHost.module.css";

type RenderedToast = ToastItem & { progress: number };

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return subscribeToastStore((items) => {
      setToasts(items.filter((x) => !x.hidden).slice(-4));
    });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 100);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const now = Date.now();
    for (const t of toasts) {
      if (now - t.createdAt >= t.durationMs) ignoreToast(t.id);
    }
  }, [toasts, tick]);

  const rendered = useMemo((): RenderedToast[] => {
    const now = Date.now();
    return toasts.map((t) => {
      const elapsed = Math.max(0, now - t.createdAt);
      const progress = Math.max(
        0,
        Math.min(100, 100 - (elapsed / t.durationMs) * 100),
      );
      return { ...t, progress };
    });
  }, [toasts, tick]);

  return (
    <div className={styles.toastHost} aria-live="polite" aria-atomic="true">
      {rendered.map((t) => (
        <div
          key={t.id}
          className={cx(
            styles.toast,
            t.type === "success" ? styles.toastSuccess : styles.toastError,
          )}
        >
          <div className={styles.toastRow}>
            <div className={styles.toastMessage}>{t.message}</div>
            <button
              type="button"
              className={styles.toastDismiss}
              onClick={() => ignoreToast(t.id)}
              aria-label="Ignore notification"
            >
              ×
            </button>
          </div>
          <div className={styles.toastProgress}>
            <div
              className={styles.toastProgressBar}
              style={{ width: `${t.progress}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
