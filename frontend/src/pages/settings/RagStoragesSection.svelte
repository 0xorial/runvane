<script lang="ts">
  import { onMount } from "svelte";
  import {
    createRagStorage,
    deleteRagStorage,
    getRagSources,
    getRagStorages,
    ingestRagStorage,
    queryRagStorage,
    type CreateRagStorageInput,
    type EntitySourceInfo,
    type IngestResult,
    type RagQueryHit,
    type RagStorageInfo,
  } from "@/api/ragClient";
  import { ghostBtn } from "./settingsClasses";

  let storages = $state<RagStorageInfo[]>([]);
  let sources = $state<EntitySourceInfo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Create form.
  let name = $state("");
  let entitySource = $state("files");
  let providerId = $state("openai");
  let model = $state("text-embedding-3-small");
  let rootsText = $state("");
  let creating = $state(false);

  // Per-storage transient UI state.
  let busyId = $state<string | null>(null);
  let ingestResults = $state<Record<string, IngestResult>>({});
  let queryText = $state<Record<string, string>>({});
  let queryHits = $state<Record<string, RagQueryHit[]>>({});

  const canCreate = $derived(
    name.trim().length > 0 &&
      providerId.trim().length > 0 &&
      model.trim().length > 0 &&
      (entitySource !== "files" || rootsText.trim().length > 0),
  );

  const inputClass =
    "w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground";

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const [nextStorages, nextSources] = await Promise.all([getRagStorages(), getRagSources()]);
      storages = nextStorages;
      sources = nextSources;
      if (!sources.some((s) => s.type === entitySource) && sources[0]) entitySource = sources[0].type;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function create(): Promise<void> {
    if (!canCreate) return;
    creating = true;
    error = null;
    try {
      const sourceParams: Record<string, unknown> =
        entitySource === "files"
          ? { roots: rootsText.split("\n").map((r) => r.trim()).filter(Boolean) }
          : {};
      const input: CreateRagStorageInput = {
        name: name.trim(),
        entitySource,
        embeddingProviderId: providerId.trim(),
        embeddingModel: model.trim(),
        sourceParams,
      };
      await createRagStorage(input);
      name = "";
      rootsText = "";
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }

  async function ingest(id: string): Promise<void> {
    busyId = id;
    error = null;
    try {
      ingestResults = { ...ingestResults, [id]: await ingestRagStorage(id) };
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = null;
    }
  }

  async function runQuery(id: string): Promise<void> {
    const q = (queryText[id] ?? "").trim();
    if (!q) return;
    busyId = id;
    error = null;
    try {
      queryHits = { ...queryHits, [id]: await queryRagStorage(id, q, 8) };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = null;
    }
  }

  async function remove(id: string): Promise<void> {
    busyId = id;
    error = null;
    try {
      await deleteRagStorage(id);
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = null;
    }
  }
</script>

<main class="flex min-w-0 flex-col gap-3.5" data-testid="rag-section">
  <div>
    <h1 class="text-base font-bold text-foreground">RAG storages</h1>
    <p class="text-xs text-muted-foreground">
      Build semantic indexes the <code>rag</code> tool retrieves from. Add a storage to an agent under
      <strong>Agents → Tools → rag → storages</strong>.
    </p>
  </div>

  {#if error}
    <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert" data-testid="rag-error">
      {error}
    </div>
  {/if}

  <!-- Create -->
  <section class="rounded-lg border border-border bg-card p-3">
    <div class="mb-2 text-[13px] font-bold text-foreground">New storage</div>
    <div class="grid grid-cols-2 gap-2.5">
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">Name</span>
        <input class={inputClass} data-testid="rag-name" bind:value={name} placeholder="My docs" />
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">Entity source</span>
        <select class={inputClass} data-testid="rag-source" bind:value={entitySource}>
          {#each sources as s (s.type)}
            <option value={s.type}>{s.label}</option>
          {/each}
        </select>
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">Embedding provider id</span>
        <input class={inputClass} data-testid="rag-provider" bind:value={providerId} placeholder="openai / lmstudio" />
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">Embedding model</span>
        <input class={inputClass} data-testid="rag-model" bind:value={model} placeholder="text-embedding-3-small" />
      </label>
      {#if entitySource === "files"}
        <label class="col-span-2 flex flex-col gap-1 text-xs">
          <span class="font-semibold text-foreground">Roots (one absolute path per line)</span>
          <textarea class="{inputClass} min-h-[64px] resize-y font-mono" data-testid="rag-roots" bind:value={rootsText}
            placeholder={"/workspace/docs\n/workspace/backend/src"}></textarea>
        </label>
      {/if}
    </div>
    <div class="mt-2.5">
      <button type="button" class="{ghostBtn} border-slate-300" data-testid="rag-create" disabled={!canCreate || creating} onclick={create}>
        {creating ? "Creating…" : "Create storage"}
      </button>
    </div>
  </section>

  <!-- List -->
  {#if loading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if storages.length === 0}
    <p class="text-sm text-muted-foreground" data-testid="rag-empty">No storages yet. Create one above, then ingest it.</p>
  {:else}
    <div class="flex flex-col gap-2.5">
      {#each storages as storage (storage.id)}
        <section class="rounded-lg border border-border bg-card p-3" data-testid="rag-storage" data-storage-name={storage.name}>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-bold text-foreground" data-testid="rag-storage-name">{storage.name}</div>
              <div class="text-xs text-muted-foreground" data-testid="rag-storage-meta">
                <code>{storage.entitySource}</code> · {storage.embeddingProviderId}/{storage.embeddingModel}
                {#if storage.embeddingDim}· {storage.embeddingDim}d{/if}
                · {storage.counts.chunks} chunks / {storage.counts.sources} sources
                {#if storage.lastIngestedAt}· ingested {new Date(storage.lastIngestedAt).toLocaleString()}{:else}· never ingested{/if}
              </div>
              <div class="mt-0.5 text-[11px] text-muted-foreground">id: <code>{storage.id}</code></div>
            </div>
            <div class="flex shrink-0 gap-2">
              <button type="button" class="{ghostBtn} border-slate-300" data-testid="rag-ingest" disabled={busyId === storage.id} onclick={() => ingest(storage.id)}>
                {busyId === storage.id ? "Working…" : "Ingest"}
              </button>
              <button type="button" class="{ghostBtn} border-destructive/40 text-destructive" data-testid="rag-delete" disabled={busyId === storage.id} onclick={() => remove(storage.id)}>
                Delete
              </button>
            </div>
          </div>

          {#if ingestResults[storage.id]}
            {@const r = ingestResults[storage.id]}
            <div class="mt-2 text-xs text-muted-foreground" data-testid="rag-ingest-result">
              Ingest: +{r.added} added · {r.updated} updated · {r.skipped} skipped · {r.removed} removed
            </div>
          {/if}

          <div class="mt-2.5 flex gap-2">
            <input
              class={inputClass}
              data-testid="rag-query"
              placeholder="Test query…"
              value={queryText[storage.id] ?? ""}
              oninput={(e) => (queryText = { ...queryText, [storage.id]: e.currentTarget.value })}
              onkeydown={(e) => e.key === "Enter" && runQuery(storage.id)}
            />
            <button type="button" class="{ghostBtn} border-slate-300 shrink-0" data-testid="rag-test" disabled={busyId === storage.id} onclick={() => runQuery(storage.id)}>
              Test
            </button>
          </div>

          {#if queryHits[storage.id]}
            {#if queryHits[storage.id].length === 0}
              <div class="mt-2 text-xs text-muted-foreground" data-testid="rag-no-hits">No matches.</div>
            {:else}
              <ol class="mt-2 flex flex-col gap-1.5">
                {#each queryHits[storage.id] as hit, i (i)}
                  <li class="rounded-md border border-border bg-muted/40 p-2 text-xs" data-testid="rag-hit">
                    <div class="mb-0.5 flex justify-between gap-2 text-muted-foreground">
                      <code class="truncate" data-testid="rag-hit-source">{String(hit.metadata.relativePath ?? hit.sourceId)}</code>
                      <span class="shrink-0">{hit.score.toFixed(4)}</span>
                    </div>
                    <div class="line-clamp-3 whitespace-pre-wrap text-foreground">{hit.text}</div>
                  </li>
                {/each}
              </ol>
            {/if}
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</main>
