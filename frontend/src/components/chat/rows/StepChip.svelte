<script lang="ts">
  import type { Snippet } from "svelte";
  import RowIcon from "../RowIcon.svelte";

  let {
    icon,
    label,
    meta = "",
    metaSlot,
    badge,
    active,
    align = "left",
    testId,
    onclick,
  }: {
    icon: Snippet;
    label: string;
    meta?: string;
    metaSlot?: Snippet;
    badge?: Snippet;
    active: boolean;
    align?: "left" | "right";
    testId?: string;
    onclick: () => void;
  } = $props();

  const hasMeta = $derived(meta.trim().length > 0 || Boolean(metaSlot));
</script>

<div
  role="button"
  tabindex="0"
  data-testid={testId}
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
      <span class="min-w-0 truncate font-mono opacity-60 inline-flex items-center gap-1 flex-wrap">
        {#if label && (hasMeta)}<span>·</span>{/if}
        {#if metaSlot}
          {@render metaSlot()}
        {:else}
          {meta}
        {/if}
      </span>
    {/if}
  </span>
  {#if badge}
    <span class="shrink-0">{@render badge()}</span>
  {/if}
  <RowIcon name="chevron-down" class="h-3.5 w-3.5 shrink-0 opacity-60 transition-transform {active ? 'rotate-180' : ''}" />
</div>
