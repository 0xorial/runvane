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
  const pillBase =
    "inline-flex h-8 min-h-0 shrink-0 items-center gap-2 rounded-full px-3 text-xs font-semibold disabled:opacity-50";
  const pillPrimary = `${pillBase} shadow-sm bg-foreground text-background hover:bg-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90`;
  const pillSteer = `${pillBase} border border-destructive/40 bg-transparent text-destructive shadow-none hover:bg-destructive/10`;
  const keycapPrimary =
    "inline-flex items-center rounded bg-background/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none tracking-tight text-foreground dark:bg-primary-foreground/90 dark:text-primary";
  const keycapSteer =
    "inline-flex items-center rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none tracking-tight text-destructive ring-1 ring-inset ring-destructive/30";
</script>

{#if agentRunning}
  <div class="flex shrink-0 items-center gap-1.5">
    <button
      type="button"
      data-testid="chat-steer-button"
      class={pillSteer}
      disabled={!canSend || sending}
      onclick={() => void onSend({ steer: true })}
      aria-label="Steer agent ({mod}+Enter)"
    >
      <span class="inline-flex items-center gap-1.5">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25">
          <circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" />
        </svg>
        Steer
      </span>
      <kbd class={keycapSteer}>{mod}⏎</kbd>
    </button>
    <button
      type="button"
      data-testid="chat-enqueue-button"
      class={pillPrimary}
      disabled={!canSend || sending}
      onclick={() => void onSend({ enqueue: true })}
      aria-label="Enqueue message (Shift+Enter)"
    >
      <span class="inline-flex items-center gap-1.5">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25">
          <path d="M11 12H3" /><path d="M16 6H3" /><path d="M16 18H3" /><path d="M18 9v6" /><path d="M21 12h-6" />
        </svg>
        Enqueue
      </span>
      <kbd class={keycapPrimary}>⇧⏎</kbd>
    </button>
  </div>
{:else}
  <button
    type="button"
    data-testid="chat-send-button"
    class={pillPrimary}
    disabled={!canSend || sending}
    onclick={() => void onSend({})}
    aria-label="Send message (Shift+Enter)"
  >
    <span class="inline-flex items-center gap-1.5">
      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25">
        <path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.285 6.695a.5.5 0 0 0 .49.364H13a1 1 0 0 1 1 1v0a1 1 0 0 1-1 1H5.806a.5.5 0 0 0-.49.364l-2.285 6.695a.498.498 0 0 0 .683.627l18-8.572a.5.5 0 0 0 0-.904z" />
        <path d="M6 12h16" />
      </svg>
      Send
    </span>
    <kbd class={keycapPrimary}>⇧⏎</kbd>
  </button>
{/if}
