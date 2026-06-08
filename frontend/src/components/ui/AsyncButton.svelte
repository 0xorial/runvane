<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    disabled = false,
    class: className = "",
    onclick,
    children,
  }: {
    disabled?: boolean;
    class?: string;
    onclick: () => void | Promise<void>;
    children: Snippet;
  } = $props();

  let busy = $state(false);

  async function onClick(): Promise<void> {
    if (disabled || busy) return;
    busy = true;
    try {
      await onclick();
    } finally {
      busy = false;
    }
  }
</script>

<button type="button" class={className} disabled={disabled || busy} onclick={() => void onClick()}>
  {#if busy}
    …
  {:else}
    {@render children()}
  {/if}
</button>
