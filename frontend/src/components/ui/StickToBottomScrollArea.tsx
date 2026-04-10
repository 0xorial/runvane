import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type StickToBottomScrollAreaProps = {
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

export function StickToBottomScrollArea({
  className,
  topAnchorEntryId = null,
  children,
}: StickToBottomScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const triesRef = useRef(0);
  const [bottomSpacerPx, setBottomSpacerPx] = useState(0);

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
      console.log("viewportHeight", viewportHeight);
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
      console.log("anchorTop", anchorTop);
      console.log("anchorBottom", anchorBottom);
      console.log("contentEl.scrollHeight", contentEl.scrollHeight);
      const totalContentHeight = Math.max(0, contentEl.scrollHeight);
      console.log("totalContentHeight", totalContentHeight);
      const plan = calculateAnchorScrollPlan({
        anchorTop,
        anchorBottom,
        totalContentHeight,
        viewportHeight,
      });
      console.log("remainingContentHeight", plan.remainingContentHeight);
      console.log("requiredTailSpacer", plan.spacerHeight);
      console.log("scrollTopTarget", plan.scrollTopTarget);

      if (Math.abs(plan.spacerHeight - bottomSpacerPx) > 1) {
        setBottomSpacerPx(plan.spacerHeight);
        console.log("setting bottom spacer px", plan.spacerHeight);
        return false;
      }
      scrollEl.scrollTop = Math.max(0, plan.scrollTopTarget);
      const deltaToTop = Math.abs(
        anchor.getBoundingClientRect().top -
          scrollEl.getBoundingClientRect().top
      );
      return deltaToTop <= 1;
    },
    [bottomSpacerPx, getAnchor]
  );

  const scheduleAlign = useCallback(
    (entryId: string) => {
      cancelAlignRaf();
      triesRef.current = 0;
      const run = () => {
        if (!topAnchorEntryId || topAnchorEntryId !== entryId) return;
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
      setBottomSpacerPx(0);
      return;
    }
    scheduleAlign(topAnchorEntryId);
    return cancelAlignRaf;
  }, [cancelAlignRaf, scheduleAlign, topAnchorEntryId]);

  useEffect(() => {
    if (!topAnchorEntryId) return;
    const contentEl = contentRef.current;
    const scrollEl = scrollRef.current;
    if (!contentEl || !scrollEl) return;
    const ro = new ResizeObserver(() => {
      scheduleAlign(topAnchorEntryId);
    });
    ro.observe(contentEl);
    ro.observe(scrollEl);
    const mo = new MutationObserver(() => {
      scheduleAlign(topAnchorEntryId);
    });
    mo.observe(contentEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [scheduleAlign, topAnchorEntryId]);

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
