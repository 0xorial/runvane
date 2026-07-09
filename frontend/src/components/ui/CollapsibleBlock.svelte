<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    collapsedMaxPx = 150,
    class: className = "",
    children,
  }: {
    /** Height budget while collapsed; content within it (plus slack) renders unclamped. */
    collapsedMaxPx?: number;
    class?: string;
    children: Snippet;
  } = $props();

  // Don't clamp content that barely overflows — expanding for a few px is noise,
  // and the fade would hide more than the clamp saves.
  const SLACK_PX = 48;
  const FADE_PX = 56;

  let expanded = $state(false);
  let innerEl = $state<HTMLDivElement | null>(null);
  let overflowing = $state(false);

  // Measured on the inner (unclamped) content: the clip box keeps its own size
  // while collapsed, so watching it would miss content growth (streaming text).
  $effect(() => {
    const el = innerEl;
    if (!el) return;
    const check = () => (overflowing = el.offsetHeight > collapsedMaxPx + SLACK_PX);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  });

  const clamped = $derived(overflowing && !expanded);
  // mask-image fades the content itself to transparent, so the dimming works on
  // any background (the pres under this use several different surfaces).
  const clampStyle = $derived(
    clamped
      ? `max-height:${collapsedMaxPx}px;` +
        `mask-image:linear-gradient(to bottom, black calc(100% - ${FADE_PX}px), transparent);` +
        `-webkit-mask-image:linear-gradient(to bottom, black calc(100% - ${FADE_PX}px), transparent);`
      : "",
  );
</script>

<div class={className}>
  <div class="relative">
    <div class="overflow-hidden" style={clampStyle} data-testid="block-clip">
      <div bind:this={innerEl}>{@render children()}</div>
    </div>
    {#if clamped}
      <!-- The dimmed strip itself is the expand target. -->
      <button
        type="button"
        class="absolute inset-x-0 bottom-0 flex items-end justify-center pb-0.5"
        style="height:{FADE_PX}px"
        data-testid="block-expand"
        aria-label="Show full content"
        onclick={() => (expanded = true)}
      >
        <span
          class="rounded-full border border-border/60 bg-secondary/90 px-2 py-px text-[10px] text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          Show more
        </span>
      </button>
    {/if}
  </div>
  {#if overflowing && expanded}
    <div class="flex justify-center pt-0.5">
      <button
        type="button"
        class="rounded-full border border-border/60 bg-secondary/90 px-2 py-px text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        data-testid="block-collapse"
        aria-label="Collapse content"
        onclick={() => (expanded = false)}
      >
        Show less
      </button>
    </div>
  {/if}
</div>
