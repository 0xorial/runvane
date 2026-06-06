import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type BorderResizableProps = {
  children: ReactNode;
  className?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const HANDLE_CLS: Record<ResizeEdge, string> = {
  n: "top-0 right-3 left-3 h-2 cursor-ns-resize",
  s: "right-3 bottom-0 left-3 h-2 cursor-ns-resize",
  e: "top-3 right-0 bottom-3 w-2 cursor-ew-resize",
  w: "top-3 bottom-3 left-0 w-2 cursor-ew-resize",
  ne: "top-0 right-0 h-3 w-3 cursor-nesw-resize",
  nw: "top-0 left-0 h-3 w-3 cursor-nwse-resize",
  se: "right-0 bottom-0 h-3 w-3 cursor-nwse-resize",
  sw: "bottom-0 left-0 h-3 w-3 cursor-nesw-resize",
};

export function BorderResizable({
  children,
  className,
  defaultWidth = 416,
  defaultHeight = 280,
  minWidth = 256,
  minHeight = 128,
  maxWidth,
  maxHeight,
}: BorderResizableProps) {
  const [size, setSize] = useState({ width: defaultWidth, height: defaultHeight });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const startResize = useCallback(
    (edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      const { width: startW, height: startH } = sizeRef.current;

      const capW = maxWidth ?? window.innerWidth * 0.9;
      const capH = maxHeight ?? window.innerHeight * 0.85;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let width = startW;
        let height = startH;
        if (edge.includes("e")) width = startW + dx;
        if (edge.includes("w")) width = startW - dx;
        if (edge.includes("s")) height = startH + dy;
        if (edge.includes("n")) height = startH - dy;
        setSize({
          width: clamp(width, minWidth, capW),
          height: clamp(height, minHeight, capH),
        });
      };

      const onUp = () => {
        document.body.style.removeProperty("user-select");
        document.body.style.removeProperty("cursor");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      document.body.style.userSelect = "none";
      document.body.style.cursor = getComputedStyle(event.currentTarget).cursor;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [maxHeight, maxWidth, minHeight, minWidth],
  );

  return (
    <div
      className={cn("group/border-resize relative flex min-h-0 min-w-0 flex-col overflow-hidden", className)}
      style={{ width: size.width, height: size.height }}
    >
      {children}
      {(Object.keys(HANDLE_CLS) as ResizeEdge[]).map((edge) => (
        <div
          key={edge}
          role="separator"
          aria-label={`Resize ${edge}`}
          className={cn(
            "absolute z-20 touch-none bg-transparent transition-colors",
            "group-hover/border-resize:bg-border/30 hover:bg-primary/40 active:bg-primary/50",
            HANDLE_CLS[edge],
          )}
          onPointerDown={(e) => startResize(edge, e)}
        />
      ))}
    </div>
  );
}
