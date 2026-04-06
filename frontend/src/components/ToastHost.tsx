import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ignoreToast, subscribeToastStore } from "../utils/toast";
import type { ToastItem } from "../utils/toast";

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
    <div
      className="pointer-events-none fixed right-3 top-3 z-[100] flex w-[min(420px,calc(100vw-1.5rem))] flex-col gap-2"
      aria-live="polite"
      aria-atomic="true"
    >
      {rendered.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto rounded-md border border-border bg-card p-3 text-card-foreground shadow-lg",
            t.type === "success"
              ? "border-emerald-500/40"
              : "border-destructive/40",
          )}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 text-sm">{t.message}</div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => ignoreToast(t.id)}
              aria-label="Ignore notification"
            >
              ×
            </Button>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-100 ease-linear",
                t.type === "success" ? "bg-emerald-500" : "bg-destructive",
              )}
              style={{ width: `${t.progress}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
