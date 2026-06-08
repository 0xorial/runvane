<script lang="ts">
  import Icon from "@/components/ui/Icon.svelte";
  import type { PendingMessage } from "@/lib/chatSessionStore";

  let {
    messages,
    onCancel,
  }: {
    messages: PendingMessage[];
    onCancel: (clientRequestId: string) => void;
  } = $props();
</script>

{#if messages.length > 0}
  <div class="mb-2 flex flex-wrap items-center gap-1.5">
    <span class="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      Queued · {messages.length}
    </span>
    {#each messages as message (message.clientRequestId)}
      <span
        class="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-border/70 bg-secondary/50 py-0.5 pl-2 pr-1 text-[11px] text-foreground/80"
        title={message.text}
      >
        <span class="truncate">{message.text}</span>
        <button
          type="button"
          class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          aria-label="Cancel queued message"
          onclick={() => onCancel(message.clientRequestId)}
        >
          <Icon name="x" class="h-3 w-3" strokeWidth={2.25} />
        </button>
      </span>
    {/each}
  </div>
{/if}
