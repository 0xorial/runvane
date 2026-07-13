<script lang="ts">
  import Icon from "@/components/ui/Icon.svelte";
  import { popupPosition } from "@/lib/popupPosition";
  import { portal } from "@/lib/portal";
  import { AGENT_COLOR_DEFAULT, AGENT_COLORS, getAgentColor } from "./agentColors";

  let {
    value,
    disabled = false,
    onchange,
  }: {
    value: string | null;
    disabled?: boolean;
    onchange: (colorId: string | null) => void;
  } = $props();

  let open = $state(false);
  let anchor = $state<HTMLButtonElement | null>(null);
  const current = $derived(getAgentColor(value));
</script>

<div class="relative">
  <button
    bind:this={anchor}
    type="button"
    {disabled}
    title="Color: {current.label}"
    class="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-muted/40 px-2 text-foreground transition-colors hover:bg-secondary/60 {disabled
      ? 'cursor-not-allowed opacity-55'
      : ''}"
    onclick={() => (open = !open)}
  >
    <span class="h-3.5 w-3.5 rounded-full {current.swatch}"></span>
    <Icon name="chevron-down" class="h-2.5 w-2.5 opacity-60" strokeWidth={2.5} />
  </button>
  {#if open && !disabled}
    <div
      use:portal
      use:popupPosition={{ anchor, gap: 4 }}
      class="fixed z-[1500] overflow-y-auto rounded-lg border border-border bg-popover p-2 shadow-xl"
      role="menu"
    >
      <div class="grid grid-cols-6 gap-1">
        <button
          type="button"
          title={AGENT_COLOR_DEFAULT.label}
          class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:bg-primary/10 {value == null
            ? 'border-primary/60 bg-primary/15'
            : ''}"
          onclick={() => {
            onchange(null);
            open = false;
          }}
        >
          <span class="h-4 w-4 rounded-full {AGENT_COLOR_DEFAULT.swatch}"></span>
        </button>
        {#each AGENT_COLORS as color (color.id)}
          <button
            type="button"
            title={color.label}
            class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:bg-primary/10 {value === color.id
              ? 'border-primary/60 bg-primary/15'
              : ''}"
            onclick={() => {
              onchange(color.id);
              open = false;
            }}
          >
            <span class="h-4 w-4 rounded-full {color.swatch}"></span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
