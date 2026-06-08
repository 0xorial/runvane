<script lang="ts">
  import type { Snippet } from "svelte";
  import RowIcon from "./RowIcon.svelte";

  let {
    role,
    badge,
    children,
    class: className = "",
  }: {
    role: "user" | "agent";
    badge?: Snippet;
    children: Snippet;
    class?: string;
  } = $props();

  const isUser = $derived(role === "user");
</script>

<div class="animate-slide-in group py-1.5 {isUser ? 'mt-7 first:mt-0' : ''} {className}">
  <div class="mx-auto flex max-w-3xl gap-3">
    <div
      class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md {isUser
        ? 'bg-secondary'
        : 'bg-primary/10 glow-accent-sm'}"
    >
      <RowIcon name={isUser ? "user" : "bot"} class="h-4 w-4 {isUser ? 'text-secondary-foreground' : 'text-primary'}" />
    </div>
    <div class="min-w-0 flex-1 space-y-1">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {isUser ? "You" : "Agent"}
        </span>
        {#if badge}
          {@render badge()}
        {/if}
      </div>
      {@render children()}
    </div>
  </div>
</div>
