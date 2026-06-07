export type PopoverResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type PopoverLayout = {
  width: number;
  height: number;
  top: number;
  left: number;
};

function growsNorth(edge: PopoverResizeEdge): boolean {
  return edge === "n" || edge === "ne" || edge === "nw";
}

function growsSouth(edge: PopoverResizeEdge): boolean {
  return edge === "s" || edge === "se" || edge === "sw";
}

function growsEast(edge: PopoverResizeEdge): boolean {
  return edge === "e" || edge === "se" || edge === "ne";
}

function growsWest(edge: PopoverResizeEdge): boolean {
  return edge === "w" || edge === "sw" || edge === "nw";
}

export function beginPopoverResize(
  event: MouseEvent,
  edge: PopoverResizeEdge,
  layout: PopoverLayout,
  onLayout: (layout: PopoverLayout) => void,
  limits: { minWidth: number; minHeight: number },
  onEnd?: () => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const start = layout;

  function onMove(ev: MouseEvent): void {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    let width = start.width;
    let height = start.height;
    let top = start.top;
    let left = start.left;

    if (growsEast(edge)) width = start.width + dx;
    if (growsWest(edge)) {
      width = start.width - dx;
      left = start.left + dx;
    }
    if (growsSouth(edge)) height = start.height + dy;
    if (growsNorth(edge)) {
      height = start.height - dy;
      top = start.top + dy;
    }

    const maxW = window.innerWidth - 16;
    const maxH = window.innerHeight - 16;
    const nextWidth = Math.min(maxW, Math.max(limits.minWidth, width));
    const nextHeight = Math.min(maxH, Math.max(limits.minHeight, height));

    if (growsNorth(edge)) top = start.top + (start.height - nextHeight);
    if (growsWest(edge)) left = start.left + (start.width - nextWidth);

    onLayout({
      width: nextWidth,
      height: nextHeight,
      top: Math.max(8, top),
      left: Math.max(8, left),
    });
  }

  function onUp(): void {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    onEnd?.();
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}
