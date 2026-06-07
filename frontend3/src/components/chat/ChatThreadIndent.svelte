<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    children,
    class: className = "",
  }: {
    children: Snippet;
    class?: string;
  } = $props();
</script>

<div class="animate-slide-in group pt-0.5 pb-0 {className}">
  <div class="mx-auto flex max-w-3xl items-start gap-3">
    <div class="w-7 shrink-0 self-start" aria-hidden="true"></div>
    <div class="min-w-0 flex-1">
      {@render children()}
    </div>
  </div>
</div>
