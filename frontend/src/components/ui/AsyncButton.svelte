<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  let {
    disabled = false,
    class: className = "",
    onclick,
    children,
    ...rest
  }: {
    disabled?: boolean;
    class?: string;
    onclick: () => void | Promise<void>;
    children: Snippet;
  } & HTMLButtonAttributes = $props();

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

<button {...rest} type="button" class={className} disabled={disabled || busy} onclick={() => void onClick()}>
  {#if busy}
    …
  {:else}
    {@render children()}
  {/if}
</button>
