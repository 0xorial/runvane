<script lang="ts">
  import { PaneResizer } from "paneforge";

  let {
    withHandle = false,
    visible = true,
    direction = "horizontal",
    class: className = "",
  }: {
    withHandle?: boolean;
    visible?: boolean;
    direction?: "horizontal" | "vertical";
    class?: string;
  } = $props();

  const orientationClass = $derived(
    direction === "horizontal"
      ? "w-px after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2"
      : "h-px w-full after:absolute after:inset-x-0 after:top-1/2 after:h-1 after:-translate-y-1/2",
  );
  const handleClass = $derived(
    direction === "horizontal"
      ? "z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border"
      : "z-10 flex h-3 w-4 items-center justify-center rounded-sm border bg-border",
  );
  const iconClass = $derived(direction === "horizontal" ? "h-2.5 w-2.5" : "h-2.5 w-2.5 rotate-90");
</script>

<PaneResizer
  class="relative flex items-center justify-center bg-border transition-opacity duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 {orientationClass} {visible ? 'opacity-100' : 'pointer-events-none opacity-0'} {className}"
  tabindex={visible ? 0 : -1}
  disabled={!visible}
>
  {#if withHandle && visible}
    <div class={handleClass}>
      <svg class={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="9" cy="12" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="9" cy="19" r="1" />
        <circle cx="15" cy="12" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="19" r="1" />
      </svg>
    </div>
  {/if}
</PaneResizer>
