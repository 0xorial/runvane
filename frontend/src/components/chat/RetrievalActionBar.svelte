<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getRagStorages, previewForcedRetrieval } from "@/api/ragClient";
  import { chatToolDraftRevision, getChatRagDraft, setChatRagDraft } from "@/lib/chatToolDraft.svelte";

  const HINT =
    "Single-shot: retrieval over the selected storages runs before the agent plans this message, " +
    "is recorded as a retrieval step, and switches off after sending.";

  const TOP_K_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
  const DEFAULT_TOP_K = 8;

  /** The message being composed — drives the live preview. */
  let { text }: { text: string } = $props();

  const storagesQuery = createQuery(() => ({
    queryKey: ["rag-storages"],
    queryFn: getRagStorages,
  }));
  const storages = $derived(storagesQuery.data ?? []);

  const draft = $derived.by(() => {
    void $chatToolDraftRevision;
    return getChatRagDraft();
  });
  const splitMode = $derived(draft.mode === "preplanned");
  const selectedNames = $derived(
    storages.filter((s) => draft.storages.includes(s.id)).map((s) => s.name),
  );

  function toggleEnabled(): void {
    const current = getChatRagDraft();
    setChatRagDraft({ ...current, enabled: !current.enabled });
  }

  function toggleStorage(id: string): void {
    const current = getChatRagDraft();
    const next = current.storages.includes(id)
      ? current.storages.filter((x) => x !== id)
      : [...current.storages, id];
    setChatRagDraft({ ...current, storages: next });
  }

  function setMode(mode: "verbatim" | "preplanned"): void {
    setChatRagDraft({ ...getChatRagDraft(), mode });
  }

  function setTopK(value: number): void {
    setChatRagDraft({ ...getChatRagDraft(), topK: value === DEFAULT_TOP_K ? undefined : value });
  }

  type Preview =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error" }
    | { status: "done"; hits: number; tokens: number };
  let preview = $state<Preview>({ status: "idle" });
  let previewSeq = 0;

  // Live feedback (Direct mode only): retrieval is cheap, so run the real
  // thing (same endpoint logic as the send path) debounced while the user
  // types, and show what a send right now would inject. In LLM-split mode the
  // queries only exist at send time, so no preview is attempted — the right
  // side says "runtime estimate" instead of pretending.
  $effect(() => {
    const enabled = draft.enabled && !splitMode;
    const storageIds = draft.storages;
    const topK = draft.topK;
    const query = text.trim();
    if (!enabled || storageIds.length === 0 || query.length === 0) {
      preview = { status: "idle" };
      return;
    }
    const seq = ++previewSeq;
    preview = { status: "loading" };
    const timer = setTimeout(() => {
      previewForcedRetrieval({ query, storages: [...storageIds], ...(topK ? { topK } : {}) }).then(
        (result) => {
          if (seq !== previewSeq) return;
          preview = { status: "done", hits: result.hits.length, tokens: result.estimatedTokens };
        },
        () => {
          if (seq !== previewSeq) return;
          preview = { status: "error" };
        },
      );
    }, 350);
    return () => clearTimeout(timer);
  });

  const previewLabel = $derived.by(() => {
    if (!draft.enabled || splitMode) return "";
    if (draft.storages.length === 0) return "pick a storage";
    if (text.trim().length === 0) return "type to preview";
    if (preview.status === "loading") return "searching…";
    if (preview.status === "error") return "preview failed";
    if (preview.status === "done") {
      const noun = preview.hits === 1 ? "excerpt" : "excerpts";
      return preview.hits === 0
        ? `no matches · injects ~${preview.tokens} tok`
        : `${preview.hits} ${noun} · ~${preview.tokens} tok`;
    }
    return "";
  });

  const chipBase =
    "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors";
  const segmentBase =
    "inline-flex h-5 shrink-0 items-center gap-1 px-2 text-[11px] font-medium transition-colors";
</script>

<div class="border-b border-border/60 px-0.5 pb-1 mb-0.5" data-testid="chat-rag-bar">
  <div class="flex flex-wrap items-center gap-1">
    <button
      type="button"
      data-testid="chat-rag-toggle"
      aria-pressed={draft.enabled}
      title={HINT}
      onclick={toggleEnabled}
      class="{chipBase} {draft.enabled
        ? 'bg-primary/15 text-primary ring-1 ring-primary/40'
        : 'text-muted-foreground hover:bg-secondary/45 hover:text-foreground'}"
    >
      <svg
        class="h-3 w-3 transition-transform {draft.enabled ? 'rotate-90' : ''}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="m9 6 6 6-6 6" />
      </svg>
      <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
      </svg>
      RAG
    </button>
    {#if draft.enabled}
      {#if storages.length === 0}
        <a href="/settings/rag" class="text-[11px] text-primary underline-offset-4 hover:underline">
          no storages configured — set up RAG ↗
        </a>
      {:else}
        {#each storages as storage (storage.id)}
          {@const selected = draft.storages.includes(storage.id)}
          <button
            type="button"
            data-testid="chat-rag-storage"
            data-storage-name={storage.name}
            aria-pressed={selected}
            title="{storage.name} ({storage.counts.chunks} chunks)"
            onclick={() => toggleStorage(storage.id)}
            class="{chipBase} font-mono {selected
              ? 'bg-primary/10 text-primary ring-1 ring-primary/40'
              : 'text-muted-foreground hover:bg-secondary/45 hover:text-foreground'}"
          >
            {#if selected}
              <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="m5 13 4 4L19 7" />
              </svg>
            {/if}
            {storage.name}
          </button>
        {/each}
        <span class="h-4 w-px shrink-0 bg-border/80" aria-hidden="true"></span>
        <div
          class="flex shrink-0 items-center overflow-hidden rounded-full ring-1 ring-border"
          role="group"
          data-testid="chat-rag-mode"
          aria-label="Query mode"
        >
          <button
            type="button"
            data-testid="chat-rag-mode-verbatim"
            aria-pressed={!splitMode}
            title="Direct: your message text is embedded as-is — the estimate on the right is exact."
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
            data-testid="chat-rag-mode-preplanned"
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
            data-testid="chat-rag-topk"
            class="cursor-pointer bg-transparent text-[11px] text-foreground outline-none"
            value={draft.topK ?? DEFAULT_TOP_K}
            onchange={(e) => setTopK(Number(e.currentTarget.value))}
          >
            {#each TOP_K_OPTIONS as k (k)}
              <option value={k}>{k}</option>
            {/each}
          </select>
        </label>
        {#if splitMode}
          <span
            class="ml-auto inline-flex items-center gap-1 pr-1 text-[11px] text-muted-foreground"
            data-testid="retrieval-runtime-note"
          >
            <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
            </svg>
            runtime estimate
          </span>
        {:else}
          <span class="ml-auto pr-1 text-[11px] tabular-nums text-muted-foreground" data-testid="retrieval-preview">
            {previewLabel}
          </span>
        {/if}
      {/if}
    {/if}
  </div>
  {#if draft.enabled && storages.length > 0}
    <div class="mt-1 flex items-start gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground">
      <svg
        class="mt-px h-3 w-3 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8h.01M12 11v5" />
      </svg>
      <p data-testid="retrieval-mode-explainer">
        {#if selectedNames.length === 0}
          Pick at least one storage — retrieval runs against it before the agent plans this message.
        {:else if splitMode}
          The agent's model will split your message into sub-queries at send time, then run one retrieval
          per query against
          {#each selectedNames as name, i (name)}{i > 0 ? ", " : ""}<strong class="font-mono font-medium text-foreground">{name}</strong>{/each}.
          Token cost is only known after splitting.
        {:else}
          Your message is embedded as-is and retrieved against
          {#each selectedNames as name, i (name)}{i > 0 ? ", " : ""}<strong class="font-mono font-medium text-foreground">{name}</strong>{/each}
          before the agent plans. The counter on the right is the exact injection.
        {/if}
      </p>
    </div>
  {/if}
</div>
