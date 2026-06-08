<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    pressed = false,
    testId,
    onclick,
    children,
  }: {
    title: string;
    pressed?: boolean;
    testId?: string;
    onclick?: () => void;
    children: Snippet;
  } = $props();
</script>

<button
  type="button"
  data-testid={testId}
  class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors {pressed
    ? 'bg-muted text-foreground hover:bg-muted'
    : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
  {title}
  aria-label={title}
  {onclick}
>
  {@render children()}
</button>
