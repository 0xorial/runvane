import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Spinner } from "./Spinner";
import { notifyError } from "../../utils/toast";
import { cx } from "../../utils/cx";
import styles from "./AsyncButton.module.css";

export type AsyncResult =
  | boolean
  | null
  | undefined
  | { ok?: boolean; error?: string; detail?: string };

export type AsyncButtonProps = {
  onClickAsync?: (event: MouseEvent<HTMLButtonElement>) => Promise<AsyncResult>;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit" | "reset";
  children?: ReactNode;
  spinnerSize?: number;
  successDurationMs?: number;
  errorDurationMs?: number;
  errorMessage?: string;
  falsyMessage?: string;
  onError?: (e: unknown) => void;
};

export type AsyncButtonHandle = {
  trigger: () => void;
};

export const AsyncButton = forwardRef<AsyncButtonHandle, AsyncButtonProps>(function AsyncButton({
  onClickAsync,
  disabled = false,
  className = "",
  type = "button",
  children,
  spinnerSize = 12,
  successDurationMs = 5000,
  errorDurationMs = 5000,
  errorMessage = "Request failed",
  falsyMessage = "Request failed. Please verify inputs and try again.",
  onError,
}, ref) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    trigger: () => {
      buttonRef.current?.click();
    },
  }));

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (state === "loading" || disabled || !onClickAsync) return;
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setState("loading");
    try {
      const result = await onClickAsync(event);
      if (result === false || result == null) {
        throw new Error(falsyMessage);
      }
      if (typeof result === "object" && result && result.ok === false) {
        throw new Error(result.error || result.detail || falsyMessage);
      }
      setState("success");
      resetTimerRef.current = setTimeout(() => {
        setState("idle");
        resetTimerRef.current = null;
      }, successDurationMs);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : String((e as { message?: string })?.message ?? errorMessage);
      setState("error");
      notifyError(message);
      if (onError) onError(e);
      else console.error(e);
      resetTimerRef.current = setTimeout(() => {
        setState("idle");
        resetTimerRef.current = null;
      }, errorDurationMs);
    }
  }

  const isLoading = state === "loading";
  const isSuccess = state === "success";
  const isError = state === "error";

  return (
    <button
      ref={buttonRef}
      type={type}
      className={cx(styles.asyncButton, className)}
      data-state={state}
      disabled={disabled || isLoading}
      onClick={handleClick}
    >
      <span className={styles.spacer} aria-hidden="true" />
      <span className={styles.label}>{children}</span>
      <span className={styles.indicator} aria-hidden="true">
        <span className={cx(styles.spinner, isLoading && styles.show)}>
          <Spinner size={spinnerSize} />
        </span>
        <span className={cx(styles.check, isSuccess && styles.show)}>✓</span>
        <span className={cx(styles.error, isError && styles.show)}>×</span>
      </span>
    </button>
  );
});
