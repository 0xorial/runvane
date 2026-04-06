import { cn } from "@/lib/utils";

type SpinnerProps = {
  size?: number;
  className?: string;
};

export function Spinner({ size = 14, className }: SpinnerProps) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full border-2 border-muted border-t-foreground/60 align-middle animate-spin",
        className,
      )}
      style={{ width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    />
  );
}
