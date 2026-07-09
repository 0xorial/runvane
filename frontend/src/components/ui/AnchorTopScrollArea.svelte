<script lang="ts">
  import { tick } from "svelte";
  import type { Snippet } from "svelte";
  import {
    calculateAnchorScrollPlan,
    offsetTopWithinAncestor,
    smoothScrollTo,
    type AnchorScrollPlan,
  } from "@/lib/anchorScroll";

  let {
    anchorEntryId = null,
    alignToken = 0,
    resetKey = null,
    class: className = "",
    testId,
    children,
  }: {
    /** Row to align to the viewport top. Follows rekeys; changing it alone never scrolls. */
    anchorEntryId?: string | null;
    /** Bumped once per explicit align event (send / branch pick); the only scroll trigger. */
    alignToken?: number;
    /** Any change (conversation switch) resets to a fresh stuck-to-bottom view. */
    resetKey?: string | null;
    class?: string;
    testId?: string;
    children: Snippet;
  } = $props();

  let scrollEl = $state<HTMLDivElement | null>(null);
  let contentEl = $state<HTMLDivElement | null>(null);
  let bottomSpacerPx = $state(0);
  let bottomSpacerRef = 0;
  // Seeded on each effect's first run (undefined = not yet seeded): a remount
  // (panel toggle) must not replay an align the user triggered earlier, nor
  // treat the mount itself as a conversation switch.
  let alignedToken: number | undefined = undefined;
  let lastResetKey: string | null | undefined = undefined;
  let lastAnchorId: string | null = null;
  let rafRef: number | null = null;
  const animRafRef = { current: null as number | null };
  let tries = 0;

  const BOTTOM_STICK_THRESHOLD_PX = 8;
  // The follow decision is derived per growth-tick from the GEOMETRY BEFORE
  // the change (was the user's position at the then-bottom?), never from
  // scroll-event state: scroll handlers observe layout later than the writes
  // that caused them, so state kept there detaches on pin-vs-growth races and
  // on the align animation's transit frames (the expanded-tool-request bug:
  // the follow silently died around a send, and later growth — a tool card
  // expanding for approval — stayed below the fold). A fresh send-align
  // reserves a spacer that makes the anchored position the bottom, so the
  // follow hands off naturally: growth first consumes the reservation (view
  // anchored, no movement), then pins downward.
  let prevScrollHeight = 0;
  let prevClientHeight = 0;

  function wasAtBottomBefore(scroll: HTMLElement): boolean {
    if (prevScrollHeight === 0) return true; // first observation: fresh view sticks
    return prevScrollHeight - scroll.scrollTop - prevClientHeight <= BOTTOM_STICK_THRESHOLD_PX;
  }

  function notePinBaseline(): void {
    if (!scrollEl) return;
    prevScrollHeight = scrollEl.scrollHeight;
    prevClientHeight = scrollEl.clientHeight;
  }

  function pinToBottom(): void {
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    notePinBaseline();
  }

  /** Stop the align loop only — a smooth-scroll already underway keeps going. */
  function cancelAlignLoop(): void {
    if (rafRef != null) cancelAnimationFrame(rafRef);
    rafRef = null;
  }

  function cancelAlignRaf(): void {
    cancelAlignLoop();
    if (animRafRef.current != null) cancelAnimationFrame(animRafRef.current);
    animRafRef.current = null;
  }

  function getAnchor(entryId: string): HTMLElement | null {
    if (!contentEl) return null;
    return contentEl.querySelector<HTMLElement>(`[data-chat-entry-id="${entryId}"]`);
  }

  function measurePlan(entryId: string): AnchorScrollPlan | null {
    const scroll = scrollEl;
    const content = contentEl;
    const anchor = getAnchor(entryId);
    if (!scroll || !content || !anchor) return null;

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
    return calculateAnchorScrollPlan({
      anchorTop,
      anchorBottom,
      totalContentHeight: Math.max(0, content.scrollHeight),
      viewportHeight,
    });
  }

  /** Refresh the reserved spacer for the current anchor without any scrolling. */
  function updateSpacer(entryId: string): void {
    const plan = measurePlan(entryId);
    if (!plan) return;
    if (Math.abs(plan.spacerHeight - bottomSpacerRef) > 1) {
      bottomSpacerRef = plan.spacerHeight;
      bottomSpacerPx = plan.spacerHeight;
    }
  }

  function clearSpacer(): void {
    bottomSpacerRef = 0;
    bottomSpacerPx = 0;
  }

  // True once the current align request has scrolled (or been abandoned by a
  // reset). An unfulfilled request may re-fire when its row id resolves; a
  // fulfilled one never scrolls again — the user may have moved on.
  let alignFulfilled = true;

  function scheduleAlign(entryId: string): void {
    cancelAlignRaf();
    alignFulfilled = false;
    tries = 0;
    let spacerApplied = false;
    const run = () => {
      rafRef = null;
      if (anchorEntryId !== entryId) return; // retargeted; the effect reschedules
      const plan = measurePlan(entryId);
      if (!plan) {
        // Row not rendered yet (fresh conversation still streaming in).
        tries += 1;
        if (tries <= 30) rafRef = requestAnimationFrame(run);
        return;
      }
      if (!spacerApplied && Math.abs(plan.spacerHeight - bottomSpacerRef) > 1) {
        // Phase 1: reserve the spacer, give it one frame to hit the DOM.
        spacerApplied = true;
        bottomSpacerRef = plan.spacerHeight;
        bottomSpacerPx = plan.spacerHeight;
        rafRef = requestAnimationFrame(run);
        return;
      }
      // Phase 2: scroll. The target only depends on content ABOVE the anchor,
      // so it's stable even while the reply streams in below — never wait for
      // frame-to-frame layout stability, it may not arrive.
      smoothScrollTo(scrollEl!, Math.max(0, plan.scrollTopTarget), animRafRef);
      alignFulfilled = true;
    };
    rafRef = requestAnimationFrame(run);
  }

  // Conversation switch: land at the bottom of the new transcript. Deliberately
  // leaves alignFulfilled alone — a send that CREATES the conversation requests
  // its align before the navigation, and that request must survive the reset
  // (it re-fires when the placeholder id resolves to the real row). Abandoning
  // a request is solely the anchor-going-null branch's job.
  $effect(() => {
    const key = resetKey;
    if (lastResetKey === undefined) {
      lastResetKey = key;
      return;
    }
    if (key === lastResetKey) return;
    lastResetKey = key;
    cancelAlignRaf();
    lastAnchorId = null;
    clearSpacer();
    pinToBottom();
  });

  // Aligning is an EVENT (token bump on send / branch pick), never state sync:
  // a conversation loading, an SSE re-snapshot, or a row rekey must not scroll
  // the transcript on their own.
  $effect(() => {
    const id = anchorEntryId;
    const token = alignToken;
    if (alignedToken === undefined) alignedToken = token;
    if (!id) {
      alignedToken = token;
      cancelAlignRaf();
      alignFulfilled = true;
      lastAnchorId = null;
      clearSpacer();
      return;
    }
    if (token !== alignedToken) {
      alignedToken = token;
      lastAnchorId = id;
      scheduleAlign(id);
      return cancelAlignLoop;
    }
    if (id !== lastAnchorId) {
      // Same align event, new row id: a placeholder or optimistic id resolved
      // to the server row. Re-fire only if the request hasn't scrolled yet.
      lastAnchorId = id;
      if (!alignFulfilled) {
        scheduleAlign(id);
        return cancelAlignLoop;
      }
    }
  });

  $effect(() => {
    const scroll = scrollEl;
    const content = contentEl;
    if (!scroll || !content) return;

    const observer = new ResizeObserver(() => {
      const follow = wasAtBottomBefore(scroll);
      // The reserved spacer only exists so the anchor can reach the viewport
      // top while the content below it is still short. As real content
      // arrives below the anchor (streaming reply, a tool card expanding for
      // approval), the reservation must shrink accordingly — otherwise the
      // transcript keeps phantom space under the last row and "bottom" stops
      // being the bottom. Safe against the align's own two-phase spacer
      // write: the spacer div sits OUTSIDE the observed content (no feedback
      // loop), and the align's scroll target depends only on content above
      // the anchor.
      if (lastAnchorId) updateSpacer(lastAnchorId);
      void tick().then(() => {
        if (follow) pinToBottom();
        else notePinBaseline();
      });
    });
    observer.observe(content);
    return () => observer.disconnect();
  });

  // The reserved spacer is sized against the viewport's own height (see
  // calculateAnchorScrollPlan), so recompute it when the viewport resizes
  // (side panel toggle, composer growing, window resize). Never scroll from
  // here: when the user sits at the bottom, keep the bottom pinned; when they
  // scrolled up to read, leave their position alone.
  $effect(() => {
    const scroll = scrollEl;
    if (!scroll) return;

    const observer = new ResizeObserver(() => {
      const follow = wasAtBottomBefore(scroll);
      if (lastAnchorId && rafRef == null) updateSpacer(lastAnchorId);
      void tick().then(() => {
        if (follow) pinToBottom();
        else notePinBaseline();
      });
    });
    observer.observe(scroll);
    return () => observer.disconnect();
  });
</script>

<div bind:this={scrollEl} class={className} data-testid={testId}>
  <div bind:this={contentEl} class="relative flex min-h-full flex-col gap-0">
    {@render children()}
  </div>
  <div aria-hidden="true" class="shrink-0" style="height: {bottomSpacerPx}px"></div>
</div>
