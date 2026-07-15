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
  // Inert state is a token-colored fill (not dimmed brand color): the teal
  // fill appears only when the message is ready to send, so the accent itself
  // signals "ready" instead of leaving a washed-out slab in the idle composer.
  const pillBase =
    "inline-flex h-8 min-h-0 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-semibold disabled:pointer-events-none disabled:bg-secondary/60 disabled:text-muted-foreground disabled:shadow-none disabled:border-transparent dark:disabled:bg-secondary/40";
  // One brand CTA in both themes (was near-black in light, teal in dark).
  const pillPrimary = `${pillBase} shadow-sm bg-primary text-primary-foreground hover:bg-primary/90`;
  const pillSteer = `${pillBase} border border-primary/40 bg-transparent text-primary shadow-none hover:bg-primary/10`;
  // Shortcut hints inherit the button's own color, just dimmed — no chip, no
  // separator glyphs.
  const keycapHint = "font-mono text-[11px] font-medium leading-none opacity-70 dark:opacity-80";
</script>

{#snippet enterKbd()}
  <kbd class={keycapHint} aria-hidden="true">⏎</kbd>
{/snippet}

{#if agentRunning}
  <div class="flex shrink-0 items-center gap-1.5">
    <button
      type="button"
      data-testid="chat-steer-button"
      class={pillSteer}
      disabled={!canSend || sending}
      onclick={() => void onSend({ steer: true })}
      aria-label="Steer agent ({mod}+Shift+Enter)"
    >
      <span class="inline-flex items-center gap-1.5">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" />
        </svg>
        Steer
      </span>
      <kbd class={keycapHint} aria-hidden="true">{mod}⇧⏎</kbd>
    </button>
    <button
      type="button"
      data-testid="chat-enqueue-button"
      class={pillPrimary}
      disabled={!canSend || sending}
      onclick={() => void onSend({ enqueue: true })}
      aria-label="Enqueue message (Enter)"
    >
      <span class="inline-flex items-center gap-1.5">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 12H3" /><path d="M16 6H3" /><path d="M16 18H3" /><path d="M18 9v6" /><path d="M21 12h-6" />
        </svg>
        Enqueue
      </span>
      {@render enterKbd()}
    </button>
  </div>
{:else}
  <button
    type="button"
    data-testid="chat-send-button"
    class={pillPrimary}
    disabled={!canSend || sending}
    onclick={() => void onSend({})}
    aria-label="Send message (Enter)"
  >
    <span class="inline-flex items-center gap-1.5">
      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.285 6.695a.5.5 0 0 0 .49.364H13a1 1 0 0 1 1 1v0a1 1 0 0 1-1 1H5.806a.5.5 0 0 0-.49.364l-2.285 6.695a.498.498 0 0 0 .683.627l18-8.572a.5.5 0 0 0 0-.904z" />
        <path d="M6 12h16" />
      </svg>
      Send
    </span>
  </button>
{/if}
