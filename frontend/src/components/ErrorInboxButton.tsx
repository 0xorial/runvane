import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { dismissAllToasts, dismissToast, subscribeToastStore } from "../utils/toast";
import type { ToastItem } from "../utils/toast";

export function ErrorInboxButton() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToastStore(setItems), []);

  const errors = items.filter((x) => x.type === "error");
  const count = errors.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(
            "relative h-8 w-8 text-muted-foreground",
            count > 0 && "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100",
          )}
          aria-label={count > 0 ? `Errors (${count})` : "Errors"}
          title={count > 0 ? `Errors (${count})` : "Errors"}
        >
          <span aria-hidden="true">⚠</span>
          {count > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <strong className="text-sm">Error notifications</strong>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              dismissAllToasts();
              setOpen(false);
            }}
            disabled={count === 0}
          >
            Dismiss all
          </Button>
        </div>
        {count === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">No errors.</div>
        ) : (
          <div className="max-h-64 overflow-y-auto p-2">
            {errors
              .slice()
              .reverse()
              .map((t) => (
                <div
                  key={t.id}
                  className="mb-1 flex gap-2 rounded-md border border-border bg-muted/40 p-2 text-sm last:mb-0"
                >
                  <div className="min-w-0 flex-1 break-words">{t.message}</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => dismissToast(t.id)}
                    aria-label="Dismiss error"
                  >
                    ×
                  </Button>
                </div>
              ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
