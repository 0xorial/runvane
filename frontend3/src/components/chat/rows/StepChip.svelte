<script lang="ts">
  import type { Snippet } from "svelte";
  import RowIcon from "../RowIcon.svelte";

  let {
    icon,
    label,
    meta = "",
    active,
    align = "left",
    onclick,
  }: {
    icon: Snippet;
    label: string;
    meta?: string;
    active: boolean;
    align?: "left" | "right";
    onclick: () => void;
  } = $props();

  const hasMeta = $derived(meta.trim().length > 0);
</script>

<div
  role="button"
  tabindex="0"
  onclick={onclick}
  onkeydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onclick();
    }
  }}
  class="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1 overflow-hidden rounded px-2 py-1 transition-colors {align === 'right'
    ? 'justify-end text-right'
    : 'justify-start text-left'} {active ? 'bg-secondary text-foreground' : 'hover:bg-secondary/60 hover:text-foreground'}"
>
  <span class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
    {@render icon()}
  </span>
  <span class="inline-flex min-w-0 items-center gap-1 {align === 'right' ? '' : 'flex-1'}">
    {#if label}
      <span class="truncate font-medium">{label}</span>
    {/if}
    {#if hasMeta}
      <span class="min-w-0 truncate opacity-60">
        {#if label}· {/if}{meta}
      </span>
    {/if}
  </span>
  <RowIcon name="chevron-down" class="h-3.5 w-3.5 shrink-0 opacity-60 transition-transform {active ? 'rotate-180' : ''}" />
</div>
