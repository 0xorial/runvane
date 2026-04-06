import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { notifyError } from "../../utils/toast";
import { Spinner } from "./Spinner";

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
  /** Circular icon send (toolbar layout); overlays spinner / ✓ / × on the glyph */
  iconOnly?: boolean;
  /** When children are non-text (e.g. icon-only), set for a11y */
  ariaLabel?: string;
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
  className,
  type = "button",
  children,
  iconOnly = false,
  ariaLabel,
  spinnerSize = 12,
  successDurationMs = 5000,
  errorDurationMs = 5000,
  errorMessage = "Request failed",
  falsyMessage = "Request failed. Please verify inputs and try again.",
  onError,
}, ref) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
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

  if (iconOnly) {
    return (
      <button
        ref={buttonRef}
        type={type}
        className={cn(
          buttonVariants({ variant: "default", size: "icon" }),
          "relative !h-8 !w-8 !min-h-0 shrink-0 rounded-full shadow-sm",
          className,
        )}
        data-state={state}
        disabled={disabled || isLoading}
        onClick={handleClick}
        aria-label={ariaLabel}
      >
        <span className="relative flex h-full w-full items-center justify-center">
          <span
            className={cn(
              "flex items-center justify-center transition-opacity duration-150",
              (isLoading || isSuccess || isError) && "opacity-0",
            )}
          >
            {children}
          </span>
          <span
            className={cn(
              "pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-[opacity,transform] duration-200",
              isLoading && "opacity-100",
            )}
            aria-hidden
          >
            <Spinner size={spinnerSize} />
          </span>
          <span
            className={cn(
              "pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-extrabold text-emerald-600 opacity-0 scale-90 transition-[opacity,transform] duration-200",
              isSuccess && "opacity-100 scale-100",
            )}
            aria-hidden
          >
            ✓
          </span>
          <span
            className={cn(
              "pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-extrabold text-destructive opacity-0 scale-90 transition-[opacity,transform] duration-200",
              isError && "opacity-100 scale-100",
            )}
            aria-hidden
          >
            ×
          </span>
        </span>
      </button>
    );
  }

  return (
    <button
      ref={buttonRef}
      type={type}
      className={cn(
        buttonVariants({ variant: "default", size: "default" }),
        "relative inline-flex min-h-9 items-center justify-center gap-2",
        className,
      )}
      data-state={state}
      disabled={disabled || isLoading}
      onClick={handleClick}
      aria-label={ariaLabel}
    >
      <span className="pointer-events-none inline-block h-4 w-4 shrink-0 opacity-0" aria-hidden />
      <span className="transition-[opacity,transform] duration-150">{children}</span>
      <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center opacity-0 scale-90 transition-[opacity,transform] duration-200",
            isLoading && "opacity-100 scale-100",
          )}
        >
          <Spinner size={spinnerSize} />
        </span>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center text-sm font-extrabold text-emerald-600 opacity-0 scale-90 transition-[opacity,transform] duration-200",
            isSuccess && "opacity-100 scale-100",
          )}
        >
          ✓
        </span>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center text-sm font-extrabold text-destructive opacity-0 scale-90 transition-[opacity,transform] duration-200",
            isError && "opacity-100 scale-100",
          )}
        >
          ×
        </span>
      </span>
    </button>
  );
});
