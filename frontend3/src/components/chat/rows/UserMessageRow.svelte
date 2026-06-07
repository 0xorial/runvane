<script lang="ts">
  import { API_BASE_URL, reprocessUserMessage } from "@/api/client";
  import type { UserMessageEntry } from "@/protocol/chatEntry";
  import { getChatSessionContext } from "@/lib/chatSessionContext";
  import { isModifierEnterKey } from "@/lib/submitShortcut";
  import { notifyError } from "@/utils/toast";
  import { formatExactChatTime, formatRelativeChatTime } from "@/utils/formatRelativeChatTime";
  import BranchSelector from "../BranchSelector.svelte";
  import ChatMessageShell from "../ChatMessageShell.svelte";
  import FoldFromHereButton from "./FoldFromHereButton.svelte";

  let { entry, conversationId }: { entry: UserMessageEntry; conversationId: string } = $props();

  const session = getChatSessionContext();
  let isEditing = $state(false);
  let editedText = $state("");
  let isSaving = $state(false);

  const relativeTime = $derived(formatRelativeChatTime(entry.createdAt));
  const exactTime = $derived(formatExactChatTime(entry.createdAt));
  const canEdit = $derived(Boolean(session.getConversationId()));
  const attachments = $derived(Array.isArray(entry.attachments) ? entry.attachments : []);

  function formatBytes(sizeBytes: number): string {
    if (!Number.isFinite(sizeBytes) || sizeBytes < 1024) return `${Math.max(0, Math.floor(sizeBytes || 0))} B`;
    if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function applyEdit(): Promise<void> {
    const cid = session.getConversationId();
    if (!cid || isSaving) return;
    const text = editedText.trim();
    if (!text) return;
    isSaving = true;
    try {
      const result = await reprocessUserMessage(cid, entry.id, text);
      await session.setActiveLeaf(result.data.leafEntryId);
      isEditing = false;
    } catch (e) {
      notifyError(`Failed to reprocess message: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      isSaving = false;
    }
  }
</script>

<ChatMessageShell role="user">
  {#snippet badge()}
    <div class="flex items-center gap-1">
      {#if relativeTime}
        <span
          class="text-[11px] font-normal normal-case tracking-normal text-muted-foreground"
          title={exactTime || undefined}
        >
          {relativeTime}
        </span>
      {/if}
      <BranchSelector entryId={entry.id} />
      {#if !isEditing}
        <FoldFromHereButton {conversationId} entryId={entry.id} />
      {/if}
      {#if canEdit && !isEditing}
        <button
          type="button"
          onclick={() => {
            editedText = entry.text;
            isEditing = true;
          }}
          class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          title="Edit and re-run"
          aria-label="Edit and re-run"
        >
          <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
            <path d="m15 5 4 4" />
          </svg>
        </button>
      {/if}
    </div>
  {/snippet}
  {#snippet children()}
    {#if isEditing}
      <div class="space-y-1.5">
        <textarea
          class="h-28 w-full resize-y rounded border border-border/70 bg-background px-2 py-1.5 text-sm leading-relaxed text-foreground focus:outline-none"
          bind:value={editedText}
          onkeydown={(event) => {
            if (!isModifierEnterKey(event)) return;
            event.preventDefault();
            void applyEdit();
          }}
          disabled={isSaving}
        ></textarea>
        <div class="flex justify-end gap-1.5">
          <button
            type="button"
            class="rounded border border-border/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
            onclick={() => {
              editedText = entry.text;
              isEditing = false;
            }}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded border border-primary/50 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            onclick={() => void applyEdit()}
            disabled={isSaving || editedText.trim().length === 0}
          >
            {isSaving ? "Reprocessing…" : "Reprocess"}
          </button>
        </div>
      </div>
    {:else if entry.text}
      <div class="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{entry.text}</div>
    {/if}
    {#if !isEditing && attachments.length > 0}
      <div class="grid gap-2">
        {#each attachments as file (file.id)}
          {@const href = `${API_BASE_URL}${file.url}`}
          <a
            class="grid gap-1 rounded-md border border-border bg-card/50 p-2 text-inherit no-underline"
            {href}
            target="_blank"
            rel="noreferrer"
          >
            {#if file.mimeType.startsWith("image/")}
              <img class="max-h-40 max-w-[240px] rounded-sm object-cover" src={href} alt={file.name} />
            {/if}
            <span class="break-words font-semibold">{file.name}</span>
            <span class="break-words text-xs opacity-75">{file.mimeType} - {formatBytes(file.sizeBytes)}</span>
          </a>
        {/each}
      </div>
    {/if}
  {/snippet}
</ChatMessageShell>
