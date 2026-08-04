<script lang="ts">
  import { navigate, pathOnly } from "@/lib/router";
  import {
    backTutorialStep,
    exitTutorial,
    nextTutorialStep,
    skipTutorialCompletely,
    tutorialActiveLesson,
    tutorialStepIndex,
  } from "@/lib/tutorial/tutorialStore.svelte";

  // Spotlight walkthrough over the real UI: four dim panels leave a hole over
  // the step's `[data-tour=…]` anchor (still fully interactive), a ring marks
  // it, and the instruction card sits beside it. The anchor is re-measured on
  // a short interval — cheaper and more robust than observer bookkeeping
  // across route changes, and 5 checks/sec is imperceptible.

  const PAD = 6;
  const CARD_W = 360;

  const lesson = $derived(tutorialActiveLesson());
  const stepIdx = $derived(tutorialStepIndex());
  const step = $derived(lesson ? (lesson.steps[stepIdx] ?? null) : null);

  type Box = { top: number; left: number; width: number; height: number };
  let box = $state<Box | null>(null);
  let anchorMissing = $state(false);
  // Plain mirror of `box` for change detection. The effect below must never
  // READ `box` — reading state it also writes trips
  // effect_update_depth_exceeded and poisons the whole reactive graph.
  let lastBox: Box | null = null;

  $effect(() => {
    const s = step;
    lastBox = null;
    box = null;
    anchorMissing = false;
    if (!s) return;
    if ($pathOnly !== s.route) navigate(s.route);
    if (!s.anchor) {
      anchorMissing = true;
      return;
    }
    const selector = `[data-tour="${s.anchor}"]`;
    let attempts = 0;
    let scrolled = false;
    const tick = (): void => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLElement)) {
        attempts += 1;
        // The route may still be loading; after ~3s treat the anchor as not
        // present in this UI state and fall back to a centered card.
        if (attempts > 15) anchorMissing = true;
        return;
      }
      anchorMissing = false;
      if (!scrolled) {
        scrolled = true;
        el.scrollIntoView({ block: "center" });
      }
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

  const hole = $derived(
    box
      ? {
          top: Math.max(0, box.top - PAD),
          left: Math.max(0, box.left - PAD),
          width: box.width + PAD * 2,
          height: box.height + PAD * 2,
        }
      : null,
  );

  // Card beside the hole: below it when there's room, else above; when the
  // spotlit area fills the viewport (big tables), overlap it from the top —
  // the card renders above the hole either way. Horizontally aligned with the
  // target, clamped to the viewport. Centered when there is no anchor.
  const CARD_CLEARANCE = 170;
  const cardStyle = $derived.by(() => {
    const h = hole;
    if (!h || typeof window === "undefined") return "";
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(CARD_W, vw - 24);
    const left = Math.min(Math.max(12, h.left), Math.max(12, vw - width - 12));
    const spaceBelow = vh - (h.top + h.height);
    const spaceAbove = h.top;
    const vertical =
      spaceBelow >= CARD_CLEARANCE
        ? `top: ${h.top + h.height + 12}px;`
        : spaceAbove >= CARD_CLEARANCE
          ? `bottom: ${vh - h.top + 12}px;`
          : "top: 12px;";
    return `left: ${left}px; width: ${width}px; ${vertical}`;
  });

  function onKeydown(e: KeyboardEvent): void {
    if (!lesson) return;
    if (e.key === "Escape") exitTutorial();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if lesson && step}
  <div class="fixed inset-0 z-[90]" data-testid="tutorial-overlay">
    {#if hole}
      <!-- Four panels around the hole: everything else is dimmed AND click-blocked;
           the spotlit element stays fully usable. -->
      <div class="absolute bg-black/55" data-testid="tutorial-dim" style="top: 0; left: 0; right: 0; height: {hole.top}px;"></div>
      <div class="absolute bg-black/55" data-testid="tutorial-dim" style="top: {hole.top + hole.height}px; left: 0; right: 0; bottom: 0;"></div>
      <div class="absolute bg-black/55" data-testid="tutorial-dim" style="top: {hole.top}px; left: 0; width: {hole.left}px; height: {hole.height}px;"></div>
      <div class="absolute bg-black/55" data-testid="tutorial-dim" style="top: {hole.top}px; left: {hole.left + hole.width}px; right: 0; height: {hole.height}px;"></div>
      <div
        class="pointer-events-none absolute rounded-lg border-2 border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]"
        data-testid="tutorial-ring"
        style="top: {hole.top}px; left: {hole.left}px; width: {hole.width}px; height: {hole.height}px;"
      ></div>
    {:else if anchorMissing}
      <div class="absolute inset-0 bg-black/55" data-testid="tutorial-dim"></div>
    {/if}

    <div
      class="fixed z-[95] rounded-xl border border-border bg-card p-3.5 shadow-xl {hole
        ? ''
        : 'left-1/2 top-1/2 w-[min(360px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2'}"
      style={hole ? cardStyle : ""}
      data-testid="tutorial-card"
      role="dialog"
      aria-label="Tutorial step"
    >
      <div class="mb-1 flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="text-[11px] text-muted-foreground">{lesson.title}</div>
          <div class="text-sm font-semibold text-foreground">{step.title}</div>
        </div>
        <button
          type="button"
          class="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Exit tutorial"
          data-testid="tutorial-exit"
          onclick={exitTutorial}
        >
          ✕
        </button>
      </div>
      <p class="text-[13px] leading-snug text-muted-foreground">{step.body}</p>
      <div class="mt-3 flex items-center justify-between gap-2">
        <span class="flex items-center gap-2.5">
          <span class="text-[11px] text-muted-foreground" data-testid="tutorial-step-count">
            {stepIdx + 1} / {lesson.steps.length}
          </span>
          <button
            type="button"
            class="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-muted-foreground underline hover:text-foreground"
            title="Close and stop auto-started lessons and tips. Everything stays replayable from Settings → Tutorial."
            data-testid="tutorial-skip"
            onclick={skipTutorialCompletely}
          >
            Skip tutorial
          </button>
        </span>
        <div class="flex items-center gap-2">
          {#if stepIdx > 0}
            <button
              type="button"
              class="rounded-lg border border-border px-2.5 py-1 text-xs text-foreground hover:bg-secondary/60"
              data-testid="tutorial-back"
              onclick={backTutorialStep}
            >
              Back
            </button>
          {/if}
          <button
            type="button"
            class="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            data-testid="tutorial-next"
            onclick={nextTutorialStep}
          >
            {stepIdx === lesson.steps.length - 1 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
