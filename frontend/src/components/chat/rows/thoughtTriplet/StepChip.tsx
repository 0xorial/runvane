import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function StepChip({
  icon,
  label,
  meta,
  active,
  align = "left",
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  meta?: string;
  active: boolean;
  align?: "left" | "right";
  onClick: () => void;
}) {
  const hasMeta = typeof meta === "string" && meta.trim().length > 0;
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
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center">{icon}</span>
      <span className="inline-flex min-w-0 items-center gap-1">
        {label ? <span className="truncate font-medium">{label}</span> : null}
        {hasMeta ? <span className="truncate opacity-60">{label ? `· ${meta}` : meta}</span> : null}
      </span>
      <ChevronDown className={cn("h-3.5 w-3.5 opacity-60 transition-transform", active ? "rotate-180" : "")} />
    </button>
  );
}

export function Connector() {
  return <span className="self-center opacity-60">→</span>;
}

export function TinyProgressCircle() {
  return <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true" />;
}
