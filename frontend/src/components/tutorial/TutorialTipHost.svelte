<script lang="ts">
  import { TUTORIAL_TIPS, type TutorialTip } from "@/lib/tutorial/lessons";
  import {
    isTipSeen,
    markTipSeen,
    setTutorialSkipped,
    tutorialActiveLesson,
    tutorialSkipped,
  } from "@/lib/tutorial/tutorialStore.svelte";

  // First-encounter tips: when an unseen tip's anchor shows up in the DOM
  // (first branch selector, first approval, …), float a small callout next to
  // it. No dimming, no click-blocking — unlike a lesson, this must not
  // interrupt a running conversation. "Got it" marks it seen for good.

  const TIP_W = 300;

  let active = $state<TutorialTip | null>(null);
  type Box = { top: number; left: number; width: number; height: number };
  let box = $state<Box | null>(null);
  // Plain mirror for change detection — the effect must never READ `box`
  // (reading state it also writes trips effect_update_depth_exceeded).
  let lastBox: Box | null = null;

  // Scan for a newly-appeared anchor of an unseen tip. Suspended while a
  // lesson runs or the tutorial is muted.
  $effect(() => {
    if (tutorialSkipped()) {
      active = null;
      return;
    }
    const scan = (): void => {
      if (tutorialActiveLesson()) return;
      if (active) {
        // Anchor gone (approval resolved, panel closed) → retract, unseen.
        if (!document.querySelector(`[data-tour="${active.anchor}"]`)) active = null;
        return;
      }
      for (const tip of TUTORIAL_TIPS) {
        if (isTipSeen(tip.id)) continue;
        if (document.querySelector(`[data-tour="${tip.anchor}"]`)) {
          active = tip;
          return;
        }
      }
    };
    scan();
    const interval = setInterval(scan, 1000);
    return () => clearInterval(interval);
  });

  // Track the active tip's anchor position (same cadence as the lesson overlay).
  $effect(() => {
    const tip = active;
    lastBox = null;
    box = null;
    if (!tip) return;
    const tick = (): void => {
      const el = document.querySelector(`[data-tour="${tip.anchor}"]`);
      if (!(el instanceof HTMLElement)) return;
      const r = el.getBoundingClientRect();
      const next: Box = { top: r.top, left: r.left, width: r.width, height: r.height };
      const cur = lastBox;
      if (
        !cur ||
        Math.abs(cur.top - next.top) > 0.5 ||
        Math.abs(cur.left - next.left) > 0.5 ||
        Math.abs(cur.width - next.width) > 0.5 ||
        Math.abs(cur.height - next.height) > 0.5
      ) {
        lastBox = next;
        box = next;
      }
    };
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  });

  // Below the anchor when there's room, else above it, clamped to the viewport.
  const tipStyle = $derived.by(() => {
    const b = box;
    if (!b || typeof window === "undefined") return "";
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(TIP_W, vw - 24);
    const left = Math.min(Math.max(12, b.left), Math.max(12, vw - width - 12));
    const vertical =
      vh - (b.top + b.height) >= 140 ? `top: ${b.top + b.height + 8}px;` : `bottom: ${vh - b.top + 8}px;`;
    return `left: ${left}px; width: ${width}px; ${vertical}`;
  });

  function gotIt(): void {
    const tip = active;
    if (!tip) return;
    markTipSeen(tip.id);
    active = null;
  }

  function turnOffTips(): void {
    setTutorialSkipped(true);
    active = null;
  }
</script>

{#if active && box}
  <div
    class="fixed z-[80] rounded-xl border border-primary/50 bg-card p-3 shadow-lg"
    style={tipStyle}
    data-testid="tutorial-tip"
    data-tip-id={active.id}
    role="note"
  >
    <div class="text-sm font-semibold text-foreground">{active.title}</div>
    <p class="mt-0.5 text-[12px] leading-snug text-muted-foreground">{active.body}</p>
    <div class="mt-2 flex items-center justify-between gap-2">
      <button
        type="button"
        class="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-muted-foreground underline hover:text-foreground"
        data-testid="tutorial-tip-off"
        onclick={turnOffTips}
      >
        Turn off tips
      </button>
      <button
        type="button"
        class="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        data-testid="tutorial-tip-got-it"
        onclick={gotIt}
      >
        Got it
      </button>
    </div>
  </div>
{/if}
