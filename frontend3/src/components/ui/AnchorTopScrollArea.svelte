<script lang="ts">
  import type { Snippet } from "svelte";
  import {
    calculateAnchorScrollPlan,
    offsetTopWithinAncestor,
    smoothScrollTo,
  } from "@/lib/anchorScroll";

  let {
    topAnchorEntryId = null,
    class: className = "",
    testId,
    children,
  }: {
    topAnchorEntryId?: string | null;
    class?: string;
    testId?: string;
    children: Snippet;
  } = $props();

  let scrollEl = $state<HTMLDivElement | null>(null);
  let contentEl = $state<HTMLDivElement | null>(null);
  let bottomSpacerPx = $state(0);
  let bottomSpacerRef = 0;
  let lastAnchorId: string | null = null;
  let rafRef: number | null = null;
  const animRafRef = { current: null as number | null };
  let tries = 0;

  function cancelAlignRaf(): void {
    if (rafRef != null) cancelAnimationFrame(rafRef);
    rafRef = null;
    if (animRafRef.current != null) cancelAnimationFrame(animRafRef.current);
    animRafRef.current = null;
  }

  function getAnchor(entryId: string): HTMLElement | null {
    if (!contentEl) return null;
    return contentEl.querySelector<HTMLElement>(`[data-chat-entry-id="${entryId}"]`);
  }

  function alignOnce(entryId: string): boolean {
    const scroll = scrollEl;
    const content = contentEl;
    const anchor = getAnchor(entryId);
    if (!scroll || !content || !anchor) return false;

    const viewportHeight = scroll.clientHeight;
    const anchorTopFromOffsets = offsetTopWithinAncestor(anchor, content);
    const anchorTop =
      anchorTopFromOffsets != null
        ? anchorTopFromOffsets
        : Math.max(
            0,
            scroll.scrollTop + (anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top),
          );
    const anchorBottom = anchorTop + anchor.offsetHeight;
    const plan = calculateAnchorScrollPlan({
      anchorTop,
      anchorBottom,
      totalContentHeight: Math.max(0, content.scrollHeight),
      viewportHeight,
    });

    if (Math.abs(plan.spacerHeight - bottomSpacerRef) > 1) {
      bottomSpacerRef = plan.spacerHeight;
      bottomSpacerPx = plan.spacerHeight;
      return false;
    }
    smoothScrollTo(scroll, Math.max(0, plan.scrollTopTarget), animRafRef);
    return true;
  }

  function scheduleAlign(entryId: string): void {
    cancelAlignRaf();
    tries = 0;
    const run = () => {
      if (topAnchorEntryId !== entryId) return;
      const done = alignOnce(entryId);
      if (done) {
        rafRef = null;
        return;
      }
      tries += 1;
      if (tries > 30) {
        rafRef = null;
        return;
      }
      rafRef = requestAnimationFrame(run);
    };
    rafRef = requestAnimationFrame(run);
  }

  $effect(() => {
    if (!topAnchorEntryId) {
      cancelAlignRaf();
      lastAnchorId = null;
      bottomSpacerRef = 0;
      bottomSpacerPx = 0;
      return;
    }
    if (lastAnchorId === topAnchorEntryId) return;
    lastAnchorId = topAnchorEntryId;
    scheduleAlign(topAnchorEntryId);
    return cancelAlignRaf;
  });

  $effect(() => {
    const content = contentEl;
    const entryId = topAnchorEntryId;
    if (!content || !entryId) return;

    const observer = new ResizeObserver(() => {
      if (topAnchorEntryId !== entryId) return;
      lastAnchorId = null;
      scheduleAlign(entryId);
    });
    observer.observe(content);
    return () => observer.disconnect();
  });
</script>

<div bind:this={scrollEl} class={className} data-testid={testId}>
  <div bind:this={contentEl} class="relative flex min-h-full flex-col gap-0">
    {@render children()}
  </div>
  <div aria-hidden="true" class="shrink-0" style="height: {bottomSpacerPx}px"></div>
</div>
