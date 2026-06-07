export type AnchorScrollInputs = {
  anchorTop: number;
  anchorBottom: number;
  totalContentHeight: number;
  viewportHeight: number;
};

export type AnchorScrollPlan = {
  remainingContentHeight: number;
  spacerHeight: number;
  scrollTopTarget: number;
};

export function calculateAnchorScrollPlan({
  anchorTop,
  anchorBottom,
  totalContentHeight,
  viewportHeight,
}: AnchorScrollInputs): AnchorScrollPlan {
  const remainingContentHeight = Math.max(0, totalContentHeight - anchorBottom);
  const anchorHeight = Math.max(0, anchorBottom - anchorTop);
  const visibleFromAnchorTop = anchorHeight + remainingContentHeight;
  const spacerHeight = Math.max(0, viewportHeight - visibleFromAnchorTop);
  const scrollTopTarget = Math.max(0, anchorTop);
  return { remainingContentHeight, spacerHeight, scrollTopTarget };
}

const SCROLL_DURATION_MS = 200;

export function smoothScrollTo(
  el: HTMLElement,
  to: number,
  animRafRef: { current: number | null },
): void {
  if (animRafRef.current != null) cancelAnimationFrame(animRafRef.current);
  const from = el.scrollTop;
  const delta = to - from;
  if (Math.abs(delta) < 1) return;
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min((now - start) / SCROLL_DURATION_MS, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.scrollTop = from + delta * eased;
    animRafRef.current = t < 1 ? requestAnimationFrame(tick) : null;
  };
  animRafRef.current = requestAnimationFrame(tick);
}

export function offsetTopWithinAncestor(node: HTMLElement, ancestor: HTMLElement): number | null {
  let top = 0;
  let current: HTMLElement | null = node;
  while (current && current !== ancestor) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  if (current !== ancestor) return null;
  return top;
}
