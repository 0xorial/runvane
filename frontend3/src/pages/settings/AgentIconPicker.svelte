<script lang="ts">
  import { getAgentColor } from "./agentColors";
  import { AGENT_ICONS, getAgentIconGlyph } from "./agentIcons";

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
  const color = $derived(getAgentColor(colorId));
</script>

<div class="relative">
  <button
    type="button"
    {disabled}
    title="Agent icon"
    class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input transition-colors hover:opacity-90 {color.wrap} {disabled
      ? 'cursor-not-allowed opacity-55'
      : ''}"
    onclick={() => (open = !open)}
  >
    <span class="text-base leading-none">{getAgentIconGlyph(value)}</span>
    <span class="ml-0.5 text-[10px] opacity-60">▾</span>
  </button>
  {#if open && !disabled}
    <div
      class="absolute left-0 top-full z-[1400] mt-1 rounded-lg border border-border bg-popover p-2 shadow-xl"
      role="menu"
    >
      <div class="grid grid-cols-5 gap-1">
        {#each AGENT_ICONS as icon (icon.id)}
          <button
            type="button"
            title={icon.label}
            class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-base hover:bg-primary/10 {value === icon.id
              ? 'border-primary/60 bg-primary/15'
              : ''}"
            onclick={() => {
              onchange(icon.id);
              open = false;
            }}
          >
            {icon.glyph}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
