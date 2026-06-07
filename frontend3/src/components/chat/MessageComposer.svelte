<script lang="ts">
  import { isModifierEnterKey, isShiftEnterKey } from "@/lib/submitShortcut";
  import ChatAgentToolbar from "./ChatAgentToolbar.svelte";
  import ComposerSendActions from "./ComposerSendActions.svelte";
  import type { ChatAgentSelection } from "./ChatAgentToolbar.svelte";
  import type { MessageSendMode } from "./sendMessage";

  let {
    value,
    onValueChange,
    canSend,
    agentRunning = false,
    sending = false,
    onSend,
    onAgentSelectionChange,
    queuedSlot,
    attachmentsSlot,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    canSend: boolean;
    agentRunning?: boolean;
    sending?: boolean;
    onSend: (mode: MessageSendMode) => void | Promise<void>;
    onAgentSelectionChange: (selection: ChatAgentSelection) => void;
    queuedSlot?: import("svelte").Snippet;
    attachmentsSlot?: import("svelte").Snippet;
  } = $props();

  let fileInput = $state<HTMLInputElement | null>(null);

  function onKeydown(event: KeyboardEvent): void {
    if (agentRunning) {
      if (isModifierEnterKey(event)) {
        event.preventDefault();
        void onSend({ steer: true });
        return;
      }
      if (isShiftEnterKey(event)) {
        event.preventDefault();
        void onSend({ enqueue: true });
      }
      return;
    }
    if (isShiftEnterKey(event)) {
      event.preventDefault();
      void onSend({});
    }
  }
</script>

<footer class="shrink-0 bg-card/40 px-2 pb-1.5 pt-1 backdrop-blur-sm">
  <input bind:this={fileInput} class="hidden" type="file" multiple disabled />
  <div class="mx-auto w-full max-w-3xl">
    {#if queuedSlot}
      <div class="mb-1.5">{@render queuedSlot()}</div>
    {/if}
    {#if attachmentsSlot}
      <div class="mb-1.5">{@render attachmentsSlot()}</div>
    {/if}
    <div
      class="flex flex-col gap-0 rounded-2xl border border-border/80 bg-card/70 p-1.5 shadow-sm transition-[box-shadow,border-color] focus-within:border-primary/35 focus-within:shadow-[0_0_0_1px_hsl(var(--primary)/0.22)] dark:bg-card/55 dark:focus-within:border-primary/40"
    >
      <textarea
        data-testid="chat-user-input"
        rows={1}
        class="scrollbar-thin min-h-[3.25rem] max-h-[80px] w-full resize-none bg-transparent px-1 py-1.5 text-sm leading-snug text-foreground outline-none placeholder:text-muted-foreground"
        placeholder="Send a message…"
        {value}
        oninput={(e) => onValueChange(e.currentTarget.value)}
        onkeydown={onKeydown}
      ></textarea>
      <div class="mt-1 flex items-end justify-between gap-2 border-t border-border/60 px-0.5 pt-1.5">
        <div class="flex min-w-0 flex-1 items-center gap-1.5 pb-0.5">
          <button
            type="button"
            class="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground hover:bg-secondary/45 hover:text-foreground"
            aria-label="Attach files"
            disabled
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
              <path
                d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
              />
            </svg>
            <span class="text-xs">Attach</span>
          </button>
          <span class="h-4 w-px shrink-0 bg-border/80" aria-hidden="true"></span>
          <div class="min-w-0 flex-1 overflow-hidden">
            <ChatAgentToolbar onSelectionChange={onAgentSelectionChange} />
          </div>
        </div>
        <ComposerSendActions {canSend} {agentRunning} {sending} {onSend} />
      </div>
    </div>
  </div>
</footer>
