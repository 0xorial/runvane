<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getConversationConfig, updateConversationConfig } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import { queryClient } from "@/lib/queryClient";
  import { navigate } from "@/lib/router";
  import { notifyError, notifySuccess } from "@/utils/toast";
  import {
    DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG,
    type ConversationCategorizationConfig,
  } from "../../../backend/src/contracts/conversation-config";
  import Icon from "@/components/ui/Icon.svelte";
  import ConversationsView from "@/components/sidebar/ConversationsView.svelte";

  let { onSelect, search = "" }: { onSelect: (id: string) => void; search?: string } = $props();

  const configQuery = createQuery(() => ({
    queryKey: queryKeys.conversationConfig,
    queryFn: getConversationConfig,
    staleTime: 60_000,
  }));

  let settingsOpen = $state(false);
  let saving = $state(false);
  // Editable draft, seeded from the server config and kept in sync until edited.
  let draft = $state<ConversationCategorizationConfig>({ ...DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG });
  let seedText = $state(DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG.seedCategories.join("\n"));
  let dirty = $state(false);

  $effect(() => {
    const data = configQuery.data;
    if (!data || dirty) return;
    draft = { ...data };
    seedText = data.seedCategories.join("\n");
  });

  function parseSeedCategories(text: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of text.split(/[\n,]/)) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }

  async function saveConfig(): Promise<void> {
    saving = true;
    try {
      const next: ConversationCategorizationConfig = {
        enabled: draft.enabled,
        sidebarRecentLimit: Math.min(200, Math.max(1, Math.trunc(draft.sidebarRecentLimit || 1))),
        seedCategories: parseSeedCategories(seedText),
        prompt: draft.prompt.trim() || DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG.prompt,
      };
      const saved = await updateConversationConfig(next);
      queryClient.setQueryData(queryKeys.conversationConfig, saved);
      dirty = false;
      draft = { ...saved };
      seedText = saved.seedCategories.join("\n");
      notifySuccess("Conversation settings saved");
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    } finally {
      saving = false;
    }
  }

  function newChat(): void {
    navigate(`/chat/new${search}`);
  }
</script>

<section class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
  <div class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden px-4 py-4">
    <div class="mb-3 flex shrink-0 items-center justify-between gap-2">
      <h1 class="text-lg font-semibold tracking-tight text-foreground">Conversations</h1>
      <div class="flex items-center gap-2">
        <button
          type="button"
          data-testid="conversations-settings-toggle"
          class="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
          aria-expanded={settingsOpen}
          onclick={() => (settingsOpen = !settingsOpen)}
        >
          <Icon name={settingsOpen ? "chevron-down" : "chevron-right"} class="h-3.5 w-3.5" />
          Categorization
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
          onclick={newChat}
        >
          <Icon name="message-square" class="h-3.5 w-3.5" />
          New Chat
        </button>
      </div>
    </div>

    {#if settingsOpen}
      <div class="mb-3 shrink-0 space-y-3 rounded-md border border-border bg-card/40 p-3 text-xs">
        <label class="flex items-center gap-2">
          <input type="checkbox" class="h-4 w-4" bind:checked={draft.enabled} oninput={() => (dirty = true)} />
          <span class="font-medium text-foreground">Auto-categorize new conversations</span>
        </label>
        <p class="text-muted-foreground">
          A system query classifies each new chat into a group after its first message. Manually moving a chat (or
          locking it) pins it so it won't be re-categorized.
        </p>

        <label class="block">
          <span class="mb-1 block font-medium text-foreground">Seed categories (one per line)</span>
          <textarea
            rows="4"
            class="w-full resize-y rounded-md border border-border bg-background px-2 py-1 font-mono"
            bind:value={seedText}
            oninput={() => (dirty = true)}
          ></textarea>
          <span class="mt-1 block text-muted-foreground">
            The model prefers these but may add a new category when none fit.
          </span>
        </label>

        <label class="block">
          <span class="mb-1 block font-medium text-foreground">Categorization system query</span>
          <textarea
            rows="5"
            class="w-full resize-y rounded-md border border-border bg-background px-2 py-1 font-mono"
            bind:value={draft.prompt}
            oninput={() => (dirty = true)}
          ></textarea>
        </label>

        <div class="flex justify-end">
          <button
            type="button"
            class="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={saving}
            onclick={() => void saveConfig()}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    {/if}

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
      <ConversationsView {onSelect} enableTextSearch dense={false} />
    </div>
  </div>
</section>
