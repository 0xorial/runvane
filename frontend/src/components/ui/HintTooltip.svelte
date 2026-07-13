<script lang="ts">
  import { popupPosition } from "@/lib/popupPosition";
  import { portal } from "@/lib/portal";
  import type { Snippet } from "svelte";

  let {
    content,
    children,
    side = "top",
    showDelayMs = 200,
  }: {
    content: string;
    children: Snippet;
    side?: "top" | "bottom";
    /** Hover delay before showing; keep at or below 500ms. */
    showDelayMs?: number;
  } = $props();

  let open = $state(false);
  let anchor = $state<HTMLSpanElement | null>(null);
  let showTimer: ReturnType<typeof setTimeout> | undefined;

  function show(): void {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      open = true;
    }, showDelayMs);
  }

  function hide(): void {
    clearTimeout(showTimer);
    showTimer = undefined;
    open = false;
  }
</script>

<!-- Hover/focus passthrough wrapper: the interactivity (tooltip) is decorative;
     the wrapped children keep their own semantics. -->
<span
  bind:this={anchor}
  role="presentation"
  class="relative inline-flex"
  onmouseenter={show}
  onmouseleave={hide}
  onfocusin={show}
  onfocusout={hide}
>
  {@render children()}
</span>

{#if open}
  <span
    use:portal
    use:popupPosition={{
      anchor,
      align: "center",
      gap: 4,
      prefer: side === "top" ? "above" : "below",
      fitHeight: false,
    }}
    class="pointer-events-none fixed z-[1500] block max-w-[min(16rem,calc(100vw-1rem))] whitespace-normal rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] leading-snug text-popover-foreground shadow-md"
    role="tooltip"
  >
    {content}
  </span>
{/if}
