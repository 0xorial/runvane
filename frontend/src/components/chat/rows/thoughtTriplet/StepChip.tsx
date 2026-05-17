import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function StepChip({
  icon,
  label,
  meta,
  badge,
  active,
  align = "left",
  onClick,
}: {
  icon: ReactNode;
  label: string;
  meta?: ReactNode;
  badge?: ReactNode;
  active: boolean;
  align?: "left" | "right";
  onClick: () => void;
}) {
  const hasMeta = meta != null && meta !== "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-w-0 flex-1 items-center gap-1 overflow-hidden rounded px-2 py-1 transition-colors",
        align === "right" ? "justify-end text-right" : "justify-start text-left",
        active ? "bg-secondary text-foreground" : "hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">{icon}</span>
      <span className={cn("inline-flex min-w-0 items-center gap-1", align === "right" ? "" : "flex-1")}>
        {label ? <span className="truncate font-medium">{label}</span> : null}
        {hasMeta ? <span className="min-w-0 truncate opacity-60">{label ? <>· {meta}</> : meta}</span> : null}
      </span>
      {badge ? <span className="shrink-0">{badge}</span> : null}
      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 opacity-60 transition-transform", active ? "rotate-180" : "")} />
    </button>
  );
}

export function Connector() {
  return <span className="self-center opacity-60">→</span>;
}

export function TinyProgressCircle() {
  return <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true" />;
}
