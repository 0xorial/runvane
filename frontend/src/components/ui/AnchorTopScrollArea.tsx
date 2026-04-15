import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type AnchorTopScrollAreaProps = {
  className?: string;
  topAnchorEntryId?: string | null;
  children: ReactNode;
};

type AnchorScrollInputs = {
  anchorTop: number;
  anchorBottom: number;
  totalContentHeight: number;
  viewportHeight: number;
};

type AnchorScrollPlan = {
  remainingContentHeight: number;
  spacerHeight: number;
  scrollTopTarget: number;
};

function calculateAnchorScrollPlan({
  anchorTop,
  anchorBottom,
  totalContentHeight,
  viewportHeight,
}: AnchorScrollInputs): AnchorScrollPlan {
  const remainingContentHeight = Math.max(0, totalContentHeight - anchorBottom);
  const anchorHeight = Math.max(0, anchorBottom - anchorTop);
  const visibleFromAnchorTop = anchorHeight + remainingContentHeight;
  const spacerHeight = Math.max(0, viewportHeight - visibleFromAnchorTop);
  // Single target formula for both branches.
  const scrollTopTarget = Math.max(0, anchorTop);
  return { remainingContentHeight, spacerHeight, scrollTopTarget };
}

export function AnchorTopScrollArea({
  className,
  topAnchorEntryId = null,
  children,
}: AnchorTopScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const triesRef = useRef(0);
  const lastAnchorIdRef = useRef<string | null>(null);
  const bottomSpacerRef = useRef(0);
  const [bottomSpacerPx, setBottomSpacerPx] = useState(0);

  useEffect(() => {
    bottomSpacerRef.current = bottomSpacerPx;
  }, [bottomSpacerPx]);

  const cancelAlignRaf = useCallback(() => {
    if (rafRef.current == null) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const getAnchor = useCallback((entryId: string): HTMLElement | null => {
    const contentEl = contentRef.current;
    if (!contentEl) return null;
    return contentEl.querySelector<HTMLElement>(
      `[data-chat-entry-id="${entryId}"]`
    );
  }, []);

  function offsetTopWithinAncestor(
    node: HTMLElement,
    ancestor: HTMLElement
  ): number | null {
    let top = 0;
    let current: HTMLElement | null = node;
    while (current && current !== ancestor) {
      top += current.offsetTop;
      current = current.offsetParent as HTMLElement | null;
    }
    if (current !== ancestor) return null;
    return top;
  }

  const alignOnce = useCallback(
    (entryId: string): boolean => {
      const scrollEl = scrollRef.current;
      const contentEl = contentRef.current;
      const anchor = getAnchor(entryId);
      if (!scrollEl || !contentEl || !anchor) return false;

      const viewportHeight = scrollEl.clientHeight;
      const anchorTopFromOffsets = offsetTopWithinAncestor(anchor, contentEl);
      const anchorTop =
        anchorTopFromOffsets != null
          ? anchorTopFromOffsets
          : Math.max(
              0,
              scrollEl.scrollTop +
                (anchor.getBoundingClientRect().top -
                  scrollEl.getBoundingClientRect().top)
            );
      const anchorBottom = anchorTop + anchor.offsetHeight;
      const totalContentHeight = Math.max(0, contentEl.scrollHeight);
      const plan = calculateAnchorScrollPlan({
        anchorTop,
        anchorBottom,
        totalContentHeight,
        viewportHeight,
      });

      if (Math.abs(plan.spacerHeight - bottomSpacerRef.current) > 1) {
        bottomSpacerRef.current = plan.spacerHeight;
        setBottomSpacerPx(plan.spacerHeight);
        return false;
      }
      scrollEl.scrollTop = Math.max(0, plan.scrollTopTarget);
      const deltaToTop = Math.abs(
        anchor.getBoundingClientRect().top -
          scrollEl.getBoundingClientRect().top
      );
      return deltaToTop <= 1;
    },
    [getAnchor]
  );

  const scheduleAlign = useCallback(
    (entryId: string) => {
      cancelAlignRaf();
      triesRef.current = 0;
      const run = () => {
        if (topAnchorEntryId !== entryId) return;
        const done = alignOnce(entryId);
        if (done) {
          rafRef.current = null;
          return;
        }
        triesRef.current += 1;
        if (triesRef.current > 30) {
          rafRef.current = null;
          return;
        }
        rafRef.current = requestAnimationFrame(run);
      };
      rafRef.current = requestAnimationFrame(run);
    },
    [alignOnce, cancelAlignRaf, topAnchorEntryId]
  );

  useEffect(() => {
    if (!topAnchorEntryId) {
      cancelAlignRaf();
      lastAnchorIdRef.current = null;
      bottomSpacerRef.current = 0;
      setBottomSpacerPx(0);
      return;
    }
    if (lastAnchorIdRef.current === topAnchorEntryId) return;
    lastAnchorIdRef.current = topAnchorEntryId;
    scheduleAlign(topAnchorEntryId);
    return cancelAlignRaf;
  }, [cancelAlignRaf, scheduleAlign, topAnchorEntryId]);

  return (
    <div ref={scrollRef} className={className}>
      <div ref={contentRef} className="relative flex min-h-full flex-col gap-0">
        {children}
      </div>
      <div
        aria-hidden
        className="shrink-0"
        style={{ height: `${bottomSpacerPx}px` }}
      />
    </div>
  );
}
