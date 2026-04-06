import { useCallback, useEffect, useRef, type ReactNode } from "react";

/** Pin state resets on remount — pass a React `key` when the scrolled “document” is replaced. */
export type StickToBottomScrollAreaProps = {
  className?: string;
  pinThresholdPx?: number;
  children: ReactNode;
};

export function StickToBottomScrollArea({
  className,
  pinThresholdPx = 120,
  children,
}: StickToBottomScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinToBottomRef = useRef(true);

  const scrollToBottomIfPinned = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !pinToBottomRef.current) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    const ro = new ResizeObserver(() => {
      scrollToBottomIfPinned();
    });
    ro.observe(contentEl);

    const mo = new MutationObserver(() => {
      scrollToBottomIfPinned();
    });
    mo.observe(contentEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    scrollToBottomIfPinned();

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [scrollToBottomIfPinned]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinToBottomRef.current = fromBottom <= pinThresholdPx;
  }

  return (
    <div ref={scrollRef} className={className} onScroll={handleScroll}>
      <div
        ref={contentRef}
        className="flex min-h-full flex-col gap-3 pb-1"
      >
        {children}
      </div>
    </div>
  );
}
