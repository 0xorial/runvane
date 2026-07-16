<script lang="ts">
  import { focusOnFirstFrame } from "@/lib/focusOnFirstFrame";
  import { isPlainEnterKey, isSteerEnterKey } from "@/lib/submitShortcut";
  import ChatAgentToolbar from "./ChatAgentToolbar.svelte";
  import ComposerSendActions from "./ComposerSendActions.svelte";
  import type { LlmRef } from "../../../../backend/src/contracts/llm";
  import type { ChatAgentSelection } from "./ChatAgentToolbar.svelte";
  import type { MessageSendMode } from "./sendMessage";

  let {
    conversationId = null,
    pathPlannerLlm = null,
    value,
    onValueChange,
    canSend,
    agentRunning = false,
    sending = false,
    onSend,
    onAgentSelectionChange,
    onPasteFiles,
    onFileInputChange,
    queuedSlot,
    attachmentsSlot,
    contextSlot,
    textareaRef = $bindable(null),
  }: {
    conversationId?: string | null;
    pathPlannerLlm?: LlmRef | null;
    value: string;
    onValueChange: (v: string) => void;
    canSend: boolean;
    agentRunning?: boolean;
    sending?: boolean;
    onSend: (mode: MessageSendMode) => void | Promise<void>;
    onAgentSelectionChange: (selection: ChatAgentSelection) => void;
    onPasteFiles?: (files: File[]) => void;
    onFileInputChange?: (files: File[]) => void;
    queuedSlot?: import("svelte").Snippet;
    attachmentsSlot?: import("svelte").Snippet;
    /** Rendered inside the input container, above the textarea; receives the
     * current draft text (drives the context-injection live previews). */
    contextSlot?: import("svelte").Snippet<[string]>;
    textareaRef?: HTMLTextAreaElement | null;
  } = $props();

  let fileInput = $state<HTMLInputElement | null>(null);

  // Enter sends (enqueues while the agent runs), Shift+Enter inserts a
  // newline (textarea default — deliberately not intercepted),
  // Ctrl/Cmd+Shift+Enter steers a running agent.
  function onKeydown(event: KeyboardEvent): void {
    // During IME composition, Enter confirms the composition — never submit.
    if (event.isComposing) return;
    if (agentRunning) {
      if (isSteerEnterKey(event)) {
        event.preventDefault();
        void onSend({ steer: true });
        return;
      }
      if (isPlainEnterKey(event)) {
        event.preventDefault();
        void onSend({ enqueue: true });
      }
      return;
    }
    if (isPlainEnterKey(event)) {
      event.preventDefault();
      void onSend({});
    }
  }

  function onPaste(event: ClipboardEvent): void {
    if (!onPasteFiles) return;
    const items = Array.from(event.clipboardData?.items ?? []);
    const images: File[] = [];
    for (const item of items) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) images.push(file);
    }
    if (images.length > 0) onPasteFiles(images);
  }
</script>

<footer class="shrink-0 bg-card/40 px-2 pb-1.5 pt-1 backdrop-blur-sm">
  <input
    bind:this={fileInput}
    class="hidden"
    type="file"
    multiple
    onchange={(e) => {
      const files = Array.from(e.currentTarget.files ?? []);
      onFileInputChange?.(files);
      e.currentTarget.value = "";
    }}
  />
  <div class="mx-auto w-full max-w-3xl">
    {#if queuedSlot}
      <div class="mb-1.5">{@render queuedSlot()}</div>
    {/if}
    {#if attachmentsSlot}
      <div class="mb-1.5">{@render attachmentsSlot()}</div>
    {/if}
    <div
      class="flex flex-col gap-0 rounded-xl border border-border bg-card/70 p-1.5 shadow-sm transition-[box-shadow,border-color] focus-within:border-primary/50 focus-within:shadow-[0_0_0_1px_hsl(var(--primary)/0.35),0_1px_2px_0_hsl(var(--foreground)/0.06)] dark:bg-[hsl(var(--surface-elevated))] dark:shadow-none dark:focus-within:border-primary/40"
    >
      {#if contextSlot}
        {@render contextSlot(value)}
      {/if}
      <textarea
        bind:this={textareaRef}
        use:focusOnFirstFrame
        data-testid="chat-user-input"
        rows={1}
        class="scrollbar-thin min-h-[2.5rem] max-h-[7rem] w-full resize-none bg-transparent px-1.5 py-1.5 text-sm leading-snug text-foreground outline-none placeholder:text-muted-foreground"
        placeholder="Send a message…"
        {value}
        oninput={(e) => onValueChange(e.currentTarget.value)}
        onkeydown={onKeydown}
        onpaste={onPaste}
      ></textarea>
      <div class="mt-1 flex items-center justify-between gap-2 border-t border-border/40 px-0.5 pt-1.5">
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          <button
            type="button"
            class="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground hover:bg-secondary/45 hover:text-foreground"
            aria-label="Attach files"
            onclick={() => fileInput?.click()}
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path
                d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
              />
            </svg>
            <span class="text-xs">Attach</span>
          </button>
          <span class="h-4 w-px shrink-0 bg-border/60" aria-hidden="true"></span>
          <div class="min-w-0 flex-1">
            <ChatAgentToolbar
              {conversationId}
              {pathPlannerLlm}
              onSelectionChange={onAgentSelectionChange}
            />
          </div>
        </div>
        <ComposerSendActions {canSend} {agentRunning} {sending} {onSend} />
      </div>
    </div>
  </div>
</footer>
