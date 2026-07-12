<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getRagStorages, previewForcedRetrieval } from "@/api/ragClient";
  import { chatToolDraftRevision, getChatRagDraft, setChatRagDraft } from "@/lib/chatToolDraft.svelte";

  const HINT =
    "Single-shot: retrieval over the selected storages runs before the agent plans this message, " +
    "is recorded as a retrieval step, and switches off after sending.";

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

  const MODE_HINT: Record<string, string> = {
    verbatim: "Verbatim: your message text is the search query.",
    preplanned:
      "Planned: a small model turns your message into targeted queries at send time " +
      "(the preview below still searches verbatim, so treat it as approximate).",
  };

  function toggleMode(): void {
    const current = getChatRagDraft();
    setChatRagDraft({ ...current, mode: current.mode === "preplanned" ? "verbatim" : "preplanned" });
  }

  type Preview =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error" }
    | { status: "done"; hits: number; tokens: number };
  let preview = $state<Preview>({ status: "idle" });
  let previewSeq = 0;

  // Live feedback: retrieval is cheap, so run the real thing (same endpoint
  // logic as the send path) debounced while the user types, and show what a
  // send right now would inject.
  $effect(() => {
    const enabled = draft.enabled;
    const storageIds = draft.storages;
    const query = text.trim();
    if (!enabled || storageIds.length === 0 || query.length === 0) {
      preview = { status: "idle" };
      return;
    }
    const seq = ++previewSeq;
    preview = { status: "loading" };
    const timer = setTimeout(() => {
      previewForcedRetrieval({ query, storages: [...storageIds] }).then(
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
    if (!draft.enabled) return "";
    if (draft.storages.length === 0) return "pick a storage";
    if (text.trim().length === 0) return "type to preview";
    if (preview.status === "loading") return "searching…";
    if (preview.status === "error") return "preview failed";
    if (preview.status === "done") {
      const noun = preview.hits === 1 ? "excerpt" : "excerpts";
      // Preplanned queries only exist at send time; the preview searches
      // verbatim, so mark it as approximate.
      const approx = draft.mode === "preplanned" ? "≈ " : "";
      return preview.hits === 0
        ? `${approx}no matches · injects ~${preview.tokens} tok`
        : `${approx}${preview.hits} ${noun} · ~${preview.tokens} tok`;
    }
    return "";
  });

  const chipBase =
    "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors";
</script>

<div class="flex flex-wrap items-center gap-1 border-b border-border/60 px-0.5 pb-1 mb-0.5" data-testid="chat-rag-bar">
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
    <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
    Retrieve
  </button>
  {#if draft.enabled}
    {#if storages.length === 0}
      <span class="text-[11px] text-muted-foreground">no storages configured (Settings → RAG)</span>
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
            ? 'bg-secondary text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-secondary/45 hover:text-foreground'}"
        >
          {storage.name}
        </button>
      {/each}
    {/if}
    <button
      type="button"
      data-testid="chat-rag-mode"
      title={MODE_HINT[draft.mode === "preplanned" ? "preplanned" : "verbatim"]}
      onclick={toggleMode}
      class="{chipBase} text-muted-foreground hover:bg-secondary/45 hover:text-foreground"
    >
      {draft.mode === "preplanned" ? "planned" : "verbatim"}
    </button>
    <span class="ml-auto pr-1 text-[11px] tabular-nums text-muted-foreground" data-testid="retrieval-preview">
      {previewLabel}
    </span>
  {/if}
</div>
