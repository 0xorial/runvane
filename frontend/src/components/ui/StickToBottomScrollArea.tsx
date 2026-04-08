import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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
    return contentEl.querySelector<HTMLElement>(`[data-chat-entry-id="${entryId}"]`);
  }, []);

  const alignOnce = useCallback(
    (entryId: string): boolean => {
      const scrollEl = scrollRef.current;
      const contentEl = contentRef.current;
      const spacerEl = spacerRef.current;
      const anchor = getAnchor(entryId);
      if (!scrollEl || !contentEl || !spacerEl || !anchor) return false;

      const viewportHeight = scrollEl.clientHeight;
      const anchorTop = anchor.offsetTop;
      const realContentHeight = Math.max(0, contentEl.scrollHeight - spacerEl.offsetHeight);
      const naturalMaxScrollTop = Math.max(0, realContentHeight - viewportHeight);
      const requiredTailSpacer = Math.max(0, anchorTop - naturalMaxScrollTop + 8);

      if (Math.abs(requiredTailSpacer - bottomSpacerPx) > 1) {
        setBottomSpacerPx(requiredTailSpacer);
        return false;
      }

      scrollEl.scrollTop = anchorTop;
      const deltaToTop = Math.abs(anchor.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top);
      return deltaToTop <= 1;
    },
    [bottomSpacerPx, getAnchor],
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
    [alignOnce, cancelAlignRaf, topAnchorEntryId],
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
    mo.observe(contentEl, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [scheduleAlign, topAnchorEntryId]);

  return (
    <div ref={scrollRef} className={className}>
      <div
        ref={contentRef}
        className="flex min-h-full flex-col gap-0 pb-0.5 [&>[data-chat-entry-id]]:shrink-0"
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
