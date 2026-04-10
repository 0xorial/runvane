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

export function StickToBottomScrollArea({
  className,
  topAnchorEntryId = null,
  children,
}: StickToBottomScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
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
      const spacerEl = spacerRef.current;
      const anchor = getAnchor(entryId);
      if (!scrollEl || !contentEl || !spacerEl || !anchor) return false;

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
      console.log("anchorTop", anchorTop);
      console.log("contentEl.scrollHeight", contentEl.scrollHeight);
      console.log("spacerEl.offsetHeight", spacerEl.offsetHeight);
      const realContentHeight = Math.max(
        0,
        contentEl.scrollHeight - spacerEl.offsetHeight
      );
      const naturalMaxScrollTop = Math.max(
        0,
        realContentHeight - viewportHeight
      );
      const requiredTailSpacer = Math.max(0, anchorTop - naturalMaxScrollTop);

      if (Math.abs(requiredTailSpacer - bottomSpacerPx) > 1) {
        setBottomSpacerPx(requiredTailSpacer);
        console.log("setting bottom spacer px", requiredTailSpacer);
        return false;
      }

      // if content below anchor is taller than viewport, scroll back to still show the anchor
      const targetScrollTop =
        requiredTailSpacer > 0
          ? scrollEl.scrollHeight - viewportHeight
          : anchorTop;
      scrollEl.scrollTop = Math.max(0, targetScrollTop);
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
      <div
        ref={contentRef}
        className="relative flex min-h-full flex-col gap-0 pb-0.5 [&>[data-chat-entry-id]]:shrink-0"
      >
        {children}
        <div
          ref={spacerRef}
          aria-hidden
          className="shrink-0"
          style={{ height: `${bottomSpacerPx}px` }}
        />
      </div>
    </div>
  );
}
