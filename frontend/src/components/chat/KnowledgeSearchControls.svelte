<script lang="ts">
  import type { Snippet } from "svelte";
  import { createQuery } from "@tanstack/svelte-query";
  import { getKnowledgeStorages } from "@/api/knowledgeClient";
  import { chatToolDraftRevision, getChatKnowledgeDraft, setChatKnowledgeDraft } from "@/lib/chatToolDraft.svelte";

  // The knowledge-search half of context injection, shared by the composer's
  // Context panel (existing conversations) and the Start context section (new
  // chats). Operates on the shared single-shot knowledge draft; hosts pass
  // context-specific extras via the snippets (live preview label, excerpt
  // list) since those depend on the message text only the composer has.
  const KNOWLEDGE_HINT =
    "Single-shot: pulls context from the selected knowledge bases before the agent plans this " +
    "message, records it in the transcript, and switches off after sending.";

  const TOP_K_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
  const DEFAULT_TOP_K = 8;

  let {
    headerRight,
    children,
  }: {
    /** Rendered at the right end of the header row (e.g. live preview label). */
    headerRight?: Snippet;
    /** Rendered between the controls and the explainer (e.g. excerpt list). */
    children?: Snippet;
  } = $props();

  const storagesQuery = createQuery(() => ({
    queryKey: ["knowledge-storages"],
    queryFn: getKnowledgeStorages,
  }));
  const storages = $derived(storagesQuery.data ?? []);

  const draft = $derived.by(() => {
    void $chatToolDraftRevision;
    return getChatKnowledgeDraft();
  });
  const splitMode = $derived(draft.mode === "preplanned");
  const selectedNames = $derived(
    storages.filter((s) => draft.storages.includes(s.id)).map((s) => s.name),
  );

  function toggleKnowledge(): void {
    const current = getChatKnowledgeDraft();
    setChatKnowledgeDraft({ ...current, enabled: !current.enabled });
  }

  function toggleStorage(id: string): void {
    const current = getChatKnowledgeDraft();
    const next = current.storages.includes(id)
      ? current.storages.filter((x) => x !== id)
      : [...current.storages, id];
    setChatKnowledgeDraft({ ...current, storages: next });
  }

  function setMode(mode: "verbatim" | "preplanned"): void {
    setChatKnowledgeDraft({ ...getChatKnowledgeDraft(), mode });
  }

  function setTopK(value: number): void {
    setChatKnowledgeDraft({ ...getChatKnowledgeDraft(), topK: value === DEFAULT_TOP_K ? undefined : value });
  }

  const chipBase =
    "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors";
  const segmentBase =
    "inline-flex h-5 shrink-0 items-center gap-1 px-2 text-[11px] font-medium transition-colors";
</script>

<div data-testid="context-knowledge-section">
  <div class="flex flex-wrap items-center gap-1.5">
    <span class="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
      <svg class="h-3 w-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
      </svg>
      Knowledge search
    </span>
    <button
      type="button"
      data-testid="chat-knowledge-toggle"
      aria-pressed={draft.enabled}
      title={KNOWLEDGE_HINT}
      onclick={toggleKnowledge}
      class="{chipBase} {draft.enabled
        ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
        : 'bg-secondary/30 text-muted-foreground ring-1 ring-border/60 hover:bg-secondary/50 hover:text-foreground'}"
    >
      <span class="h-1.5 w-1.5 rounded-full {draft.enabled ? 'bg-primary' : 'bg-muted-foreground/50'}"></span>
      {draft.enabled ? "on" : "off"}
    </button>
    {#if headerRight}
      {@render headerRight()}
    {/if}
  </div>

  {#if draft.enabled}
    <div class="mt-1 space-y-1">
      {#if storages.length === 0}
        <a href="/settings/knowledge" class="text-[11px] text-primary underline-offset-4 hover:underline">
          no knowledge bases — set one up ↗
        </a>
      {:else}
        <div class="flex flex-wrap items-center gap-1">
          {#each storages as storage (storage.id)}
            {@const selected = draft.storages.includes(storage.id)}
            <button
              type="button"
              data-testid="chat-knowledge-storage"
              data-storage-name={storage.name}
              aria-pressed={selected}
              title="{storage.name} ({storage.counts.chunks} chunks)"
              onclick={() => toggleStorage(storage.id)}
              class="{chipBase} font-mono {selected
                ? 'bg-primary/10 text-primary ring-1 ring-primary/40'
                : 'text-muted-foreground hover:bg-secondary/45 hover:text-foreground'}"
            >
              {#if selected}
                <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="m5 13 4 4L19 7" />
                </svg>
              {/if}
              {storage.name}
            </button>
          {/each}
          <span class="h-4 w-px shrink-0 bg-border/60" aria-hidden="true"></span>
          <div
            class="flex shrink-0 items-center overflow-hidden rounded-md ring-1 ring-border"
            role="group"
            data-testid="chat-knowledge-mode"
            aria-label="Query mode"
          >
            <button
              type="button"
              data-testid="chat-knowledge-mode-verbatim"
              aria-pressed={!splitMode}
              title="Direct: your message text is embedded as-is — the estimate is exact."
              onclick={() => setMode("verbatim")}
              class="{segmentBase} {!splitMode
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-secondary/45 hover:text-foreground'}"
            >
              <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
              </svg>
              Direct
            </button>
            <button
              type="button"
              data-testid="chat-knowledge-mode-preplanned"
              aria-pressed={splitMode}
              title="LLM-split: the agent's model splits your message into sub-queries at send time."
              onclick={() => setMode("preplanned")}
              class="{segmentBase} {splitMode
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-secondary/45 hover:text-foreground'}"
            >
              <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 3h5v5" />
                <path d="M8 3H3v5" />
                <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
                <path d="m15 9 6-6" />
              </svg>
              LLM-split
            </button>
          </div>
          <label class="{chipBase} cursor-pointer text-muted-foreground hover:text-foreground" title="Excerpts per query">
            k=
            <select
              data-testid="chat-knowledge-topk"
              class="cursor-pointer bg-transparent text-[11px] text-foreground outline-none"
              value={draft.topK ?? DEFAULT_TOP_K}
              onchange={(e) => setTopK(Number(e.currentTarget.value))}
            >
              {#each TOP_K_OPTIONS as k (k)}
                <option value={k}>{k}</option>
              {/each}
            </select>
          </label>
        </div>

        {#if children}
          {@render children()}
        {/if}

        <div class="flex items-start gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground">
          <svg
            class="mt-px h-3 w-3 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8h.01M12 11v5" />
          </svg>
          <p data-testid="retrieval-mode-explainer">
            {#if selectedNames.length === 0}
              Pick at least one knowledge base — it's searched before the agent plans this message.
            {:else if splitMode}
              The agent's model will split your message into sub-queries at send time, then search each of
              {#each selectedNames as name, i (name)}{i > 0 ? ", " : ""}<strong class="font-mono font-medium text-foreground">{name}</strong>{/each}.
              Token cost is only known after splitting.
            {:else}
              Your message is embedded as-is and searched against
              {#each selectedNames as name, i (name)}{i > 0 ? ", " : ""}<strong class="font-mono font-medium text-foreground">{name}</strong>{/each}
              before the agent plans. The estimate updates as you type.
            {/if}
          </p>
        </div>
      {/if}
    </div>
  {:else}
    <p class="mt-1 text-[11px] text-muted-foreground">Off — this message won't search any knowledge base.</p>
  {/if}
</div>
