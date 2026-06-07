<script lang="ts">
  import { modifierKeyLabel } from "@/lib/submitShortcut";
  import type { MessageSendMode } from "./sendMessage";

  let {
    canSend,
    agentRunning,
    onSend,
    sending = false,
  }: {
    canSend: boolean;
    agentRunning: boolean;
    onSend: (mode: MessageSendMode) => void | Promise<void>;
    sending?: boolean;
  } = $props();

  const mod = modifierKeyLabel();
  const pillPrimary =
    "inline-flex h-8 shrink-0 items-center gap-2 rounded-full bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-50 dark:bg-primary dark:text-primary-foreground";
  const pillSteer =
    "inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-destructive/40 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50";
</script>

{#if agentRunning}
  <div class="flex shrink-0 items-center gap-1.5">
    <button
      type="button"
      data-testid="chat-steer-button"
      class={pillSteer}
      disabled={!canSend || sending}
      onclick={() => void onSend({ steer: true })}
    >
      Steer <kbd class="rounded bg-destructive/15 px-1 font-mono text-[10px]">{mod}⏎</kbd>
    </button>
    <button
      type="button"
      data-testid="chat-enqueue-button"
      class={pillPrimary}
      disabled={!canSend || sending}
      onclick={() => void onSend({ enqueue: true })}
    >
      Enqueue <kbd class="rounded bg-background/90 px-1 font-mono text-[10px] dark:bg-primary-foreground/90">⇧⏎</kbd>
    </button>
  </div>
{:else}
  <button
    type="button"
    data-testid="chat-send-button"
    class={pillPrimary}
    disabled={!canSend || sending}
    onclick={() => void onSend({})}
  >
    Send <kbd class="rounded bg-background/90 px-1 font-mono text-[10px] dark:bg-primary-foreground/90">⇧⏎</kbd>
  </button>
{/if}
