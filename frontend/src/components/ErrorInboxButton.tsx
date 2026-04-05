import { useEffect, useState } from "react";
import {
  dismissAllToasts,
  dismissToast,
  subscribeToastStore,
} from "../utils/toast";
import type { ToastItem } from "../utils/toast";
import { cx } from "../utils/cx";
import styles from "./ErrorInboxButton.module.css";

export function ErrorInboxButton() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToastStore(setItems), []);

  const errors = items.filter((x) => x.type === "error");
  const count = errors.length;

  return (
    <div className={styles.errorInbox}>
      <button
        type="button"
        className={cx(styles.btn, count > 0 && styles.hasErrors)}
        onClick={() => setOpen((v) => !v)}
        aria-label={count > 0 ? `Errors (${count})` : "Errors"}
        title={count > 0 ? `Errors (${count})` : "Errors"}
      >
        <span className={styles.icon} aria-hidden="true">
          ⚠
        </span>
        {count > 0 ? <span className={styles.count}>{count}</span> : null}
      </button>
      {open ? (
        <div className={styles.popover}>
          <div className={styles.header}>
            <strong>Error notifications</strong>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => {
                dismissAllToasts();
                setOpen(false);
              }}
              disabled={count === 0}
            >
              Dismiss all
            </button>
          </div>
          {count === 0 ? (
            <div className={styles.empty}>No errors.</div>
          ) : (
            <div className={styles.list}>
              {errors
                .slice()
                .reverse()
                .map((t) => (
                  <div key={t.id} className={styles.item}>
                    <div className={styles.message}>{t.message}</div>
                    <button
                      type="button"
                      className={styles.dismiss}
                      onClick={() => dismissToast(t.id)}
                      aria-label="Dismiss error"
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
