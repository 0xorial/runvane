<script lang="ts">
  import AgentIcon from "@/components/ui/AgentIcon.svelte";
  import Icon from "@/components/ui/Icon.svelte";
  import { popupPosition } from "@/lib/popupPosition";
  import { portal } from "@/lib/portal";
  import { getAgentColor } from "./agentColors";
  import { AGENT_ICONS } from "./agentIcons";

  let {
    value,
    colorId = null,
    disabled = false,
    onchange,
  }: {
    value: string | null;
    colorId?: string | null;
    disabled?: boolean;
    onchange: (iconId: string | null) => void;
  } = $props();

  let open = $state(false);
  let anchor = $state<HTMLButtonElement | null>(null);
  const color = $derived(getAgentColor(colorId));
</script>

<div class="relative">
  <button
    bind:this={anchor}
    type="button"
    {disabled}
    title="Agent icon"
    class="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-0.5 rounded-md border border-input transition-colors hover:opacity-90 {color.wrap} {disabled
      ? 'cursor-not-allowed opacity-55'
      : ''}"
    onclick={() => (open = !open)}
  >
    <AgentIcon iconId={value} class="h-4 w-4" />
    <Icon name="chevron-down" class="h-2.5 w-2.5 opacity-60" strokeWidth={2.5} />
  </button>
  {#if open && !disabled}
    <div
      use:portal
      use:popupPosition={{ anchor, gap: 4 }}
      class="fixed z-[1500] overflow-y-auto rounded-lg border border-border bg-popover p-2 shadow-xl"
      role="menu"
    >
      <div class="grid grid-cols-5 gap-1">
        {#each AGENT_ICONS as icon (icon.id)}
          <button
            type="button"
            title={icon.label}
            class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent hover:bg-primary/10 {value === icon.id
              ? 'border-primary/60 bg-primary/15'
              : ''}"
            onclick={() => {
              onchange(icon.id);
              open = false;
            }}
          >
            <AgentIcon iconId={icon.id} class="h-4 w-4" />
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
