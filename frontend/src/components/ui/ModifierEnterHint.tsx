import { modifierKeyLabel } from "@/lib/submitShortcut";
import { cn } from "@/lib/utils";

export function ModifierEnterHint({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-mono text-[9px] leading-none text-muted-foreground/80",
        className,
      )}
      aria-hidden
    >
      <kbd className="rounded border border-border/60 bg-muted/50 px-1 py-0.5">{modifierKeyLabel()}</kbd>
      <kbd className="rounded border border-border/60 bg-muted/50 px-1 py-0.5">↵</kbd>
    </span>
  );
}
