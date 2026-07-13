/**
 * Shared viewport-aware positioning for portaled popups (dropdown panels,
 * menus, tooltips). One rule for every popup: position against the anchor,
 * flip above/below by available space, and clamp into the viewport using the
 * panel's MEASURED size — never a guessed width. Hand-rolled per-component
 * math kept sticking out of the screen the moment content grew wider than the
 * guess (model names, long menu labels).
 *
 * Usage: `<div use:portal use:popupPosition={{ anchor }}>` — `portal` first
 * (the node must be in the DOM under `document.body` before measuring).
 * The action owns `position/left/top/maxHeight`; it re-syncs on viewport
 * resize, capture-phase scroll, and panel size changes (ResizeObserver — a
 * filtered list or an expanding submenu re-clamps automatically). The chosen
 * side is exposed as `data-popup-placement="below" | "above"` for styling.
 */

export type PopupAlign = "start" | "center" | "end";
export type PopupPlacement = "below" | "above" | "right" | "left";

export type PopupPositionOptions = {
  anchor: HTMLElement | null | undefined;
  /** Main axis: "vertical" opens above/below the anchor (dropdowns, tooltips);
   *  "horizontal" opens beside it (submenus). Default "vertical". */
  axis?: "vertical" | "horizontal";
  /** Cross-axis alignment of the panel relative to the anchor. Default "start". */
  align?: PopupAlign;
  /** Gap between anchor and panel, px. Default 6. */
  gap?: number;
  /** Minimum inset from the viewport edges, px. Default 8. */
  margin?: number;
  /** Which side to use when both fit. Defaults: "below" (vertical; tooltips
   *  pass "above") / "right" (horizontal). */
  prefer?: PopupPlacement;
  /** Cap the panel's height to the available space (sets style.maxHeight).
   *  Panels should lay out as flex columns with a `min-h-0 overflow-auto`
   *  scroll area so the cap compresses the right part. Default true. */
  fitHeight?: boolean;
  /** Give the panel the anchor's width as min-width (dropdown panels). Default false. */
  minWidthFromAnchor?: boolean;
};

export function popupPosition(
  node: HTMLElement,
  options: PopupPositionOptions,
): { update(next: PopupPositionOptions): void; destroy(): void } {
  let opts = options;

  function sync(): void {
    const anchor = opts.anchor;
    if (!anchor || !anchor.isConnected) return;
    const gap = opts.gap ?? 6;
    const margin = opts.margin ?? 8;
    const axis = opts.axis ?? "vertical";
    const align = opts.align ?? "start";
    const rect = anchor.getBoundingClientRect();

    node.style.position = "fixed";
    if (opts.minWidthFromAnchor) node.style.minWidth = `${rect.width}px`;

    let placement: PopupPlacement;
    let left: number;
    let top: number;

    if (axis === "vertical") {
      const prefer = opts.prefer === "above" ? "above" : "below";
      // Height cap first (it changes the measured height), then measure.
      const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
      const spaceAbove = rect.top - gap - margin;
      // Where the panel goes: the preferred side if the panel fits there (use
      // the uncapped height for the fit test), else whichever side is larger.
      node.style.maxHeight = "";
      const naturalHeight = node.offsetHeight;
      const preferredSpace = prefer === "below" ? spaceBelow : spaceAbove;
      placement = naturalHeight <= preferredSpace ? prefer : spaceBelow >= spaceAbove ? "below" : "above";
      if (opts.fitHeight !== false) {
        const available = placement === "below" ? spaceBelow : spaceAbove;
        node.style.maxHeight = `${Math.max(120, Math.floor(available))}px`;
      }

      const width = node.offsetWidth;
      const height = node.offsetHeight;
      top = placement === "below" ? rect.bottom + gap : Math.max(margin, rect.top - gap - height);
      left =
        align === "start"
          ? rect.left
          : align === "center"
            ? rect.left + rect.width / 2 - width / 2
            : rect.right - width;
      // Clamp into the viewport; a panel wider than the viewport pins to the
      // left margin (its own max-width should prevent that case).
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    } else {
      const prefer = opts.prefer === "left" ? "left" : "right";
      const spaceRight = window.innerWidth - rect.right - gap - margin;
      const spaceLeft = rect.left - gap - margin;
      node.style.maxHeight = "";
      if (opts.fitHeight !== false) {
        node.style.maxHeight = `${Math.max(120, window.innerHeight - 2 * margin)}px`;
      }
      const naturalWidth = node.offsetWidth;
      const preferredSpace = prefer === "right" ? spaceRight : spaceLeft;
      placement = naturalWidth <= preferredSpace ? prefer : spaceRight >= spaceLeft ? "right" : "left";

      const width = node.offsetWidth;
      const height = node.offsetHeight;
      left = placement === "right" ? rect.right + gap : Math.max(margin, rect.left - gap - width);
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      top =
        align === "start"
          ? rect.top
          : align === "center"
            ? rect.top + rect.height / 2 - height / 2
            : rect.bottom - height;
      top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    }

    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.dataset.popupPlacement = placement;
  }

  sync();

  function onViewportChange(): void {
    sync();
  }
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);

  // Content growth/shrink (list filtering, submenus) re-clamps. Writes inside
  // sync() are idempotent, so an unchanged size does not re-trigger.
  const resizeObserver = new ResizeObserver(() => sync());
  resizeObserver.observe(node);

  return {
    update(next: PopupPositionOptions): void {
      opts = next;
      sync();
    },
    destroy(): void {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      resizeObserver.disconnect();
    },
  };
}
