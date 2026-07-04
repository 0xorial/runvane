<script lang="ts">
  import { onMount } from "svelte";
  import {
    createRagStorage,
    deleteRagStorage,
    getRagGraphBuilders,
    getRagSources,
    getRagStorages,
    ingestRagStorage,
    queryRagStorage,
    suggestRagRoots,
    updateRagStorage,
    type CreateRagStorageInput,
    type EntitySourceInfo,
    type GraphBuilderInfo,
    type IngestResult,
    type RagGraphContext,
    type RagQueryHit,
    type RagStorageInfo,
    type SuggestedRoot,
  } from "@/api/ragClient";
  import { cancelTask } from "@/api/client";
  import { ensureTasksStream, getTasksSnapshot } from "@/lib/tasksStore.svelte";
  import type { TaskInfo } from "../../../../backend/src/contracts/task";
  import Icon from "@/components/ui/Icon.svelte";
  import { ghostBtn } from "./settingsClasses";

  let storages = $state<RagStorageInfo[]>([]);
  let sources = $state<EntitySourceInfo[]>([]);
  let graphBuilders = $state<GraphBuilderInfo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Create form.
  let name = $state("");
  let entitySource = $state("files");
  let providerId = $state("openai");
  let model = $state("text-embedding-3-small");
  let rootsText = $state("");
  // "" = no graph layer; otherwise a builder type from graphBuilders.
  let graphBuilder = $state("");
  let graphProviderId = $state("");
  let graphModel = $state("");
  let watchNew = $state(false);
  let creating = $state(false);

  // Suggest-roots: explore a base dir, offer candidates, add the picked ones.
  let suggestBase = $state("");
  let suggesting = $state(false);
  let suggestions = $state<SuggestedRoot[] | null>(null);
  let suggestPicked = $state<Record<string, boolean>>({});

  // Per-storage transient UI state.
  let busyId = $state<string | null>(null);
  let ingestResults = $state<Record<string, IngestResult>>({});
  let queryText = $state<Record<string, string>>({});
  let queryTopK = $state<Record<string, number>>({});
  let queryUseGraph = $state<Record<string, boolean>>({});
  let queryHits = $state<Record<string, RagQueryHit[]>>({});
  let queryGraphs = $state<Record<string, RagGraphContext | null>>({});

  const canCreate = $derived(
    name.trim().length > 0 &&
      providerId.trim().length > 0 &&
      model.trim().length > 0 &&
      (entitySource !== "files" || rootsText.trim().length > 0) &&
      (graphBuilder !== "llm" || (graphProviderId.trim().length > 0 && graphModel.trim().length > 0)),
  );

  const inputClass =
    "w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground";

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const [nextStorages, nextSources, nextBuilders] = await Promise.all([
        getRagStorages(),
        getRagSources(),
        getRagGraphBuilders(),
      ]);
      storages = nextStorages;
      sources = nextSources;
      graphBuilders = nextBuilders;
      if (!sources.some((s) => s.type === entitySource) && sources[0]) entitySource = sources[0].type;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    ensureTasksStream();
    void load();
  });

  // Live indexing state per storage, straight off the tasks SSE stream — so
  // manual, watch-triggered, and even other-tab ingests all show up here.
  const indexingTasks = $derived.by(() => {
    const byStorage = new Map<string, TaskInfo>();
    for (const task of getTasksSnapshot()) {
      const storageId = task.kind === "ingest" ? task.meta.storageId : undefined;
      if (storageId) byStorage.set(storageId, task);
    }
    return byStorage;
  });

  // When an ingest task for a listed storage finishes, refresh counts/meta.
  let prevIndexing = new Set<string>();
  $effect(() => {
    const ids = new Set(indexingTasks.keys());
    const someFinished = [...prevIndexing].some((id) => !ids.has(id));
    prevIndexing = ids;
    if (someFinished) void load();
  });

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
        graph: graphBuilder
          ? {
              builder: graphBuilder,
              params:
                graphBuilder === "llm"
                  ? { providerId: graphProviderId.trim(), model: graphModel.trim() }
                  : {},
            }
          : null,
        watch: watchNew,
      };
      await createRagStorage(input);
      name = "";
      rootsText = "";
      graphBuilder = "";
      watchNew = false;
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
      const topK = Math.min(Math.max(queryTopK[id] ?? 8, 1), 50);
      const result = await queryRagStorage(id, q, topK, queryUseGraph[id] ? "graph" : "simple");
      queryHits = { ...queryHits, [id]: result.hits };
      queryGraphs = { ...queryGraphs, [id]: result.graph };
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

  async function runSuggest(): Promise<void> {
    const base = suggestBase.trim();
    if (!base || suggesting) return;
    suggesting = true;
    error = null;
    try {
      const result = await suggestRagRoots(base);
      suggestions = result.candidates;
      const picked: Record<string, boolean> = {};
      for (const c of result.candidates) picked[c.path] = c.recommended === true;
      suggestPicked = picked;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      suggesting = false;
    }
  }

  function addPickedRoots(): void {
    if (!suggestions) return;
    const existing = new Set(rootsText.split("\n").map((r) => r.trim()).filter(Boolean));
    for (const c of suggestions) {
      if (suggestPicked[c.path] && !existing.has(c.path)) existing.add(c.path);
    }
    rootsText = [...existing].join("\n");
    suggestions = null;
  }

  async function toggleWatch(storage: RagStorageInfo): Promise<void> {
    busyId = storage.id;
    error = null;
    try {
      await updateRagStorage(storage.id, { watch: !storage.watch });
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = null;
    }
  }

  function cancelIndexing(taskId: string): void {
    void cancelTask(taskId).catch((e) => {
      error = e instanceof Error ? e.message : String(e);
    });
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
        <div class="col-span-2 flex flex-col gap-1.5 text-xs">
          <div class="flex items-center gap-2">
            <input
              class={inputClass}
              data-testid="rag-suggest-base"
              placeholder="…or let the agent explore a base dir, e.g. /workspace"
              bind:value={suggestBase}
              onkeydown={(e) => e.key === "Enter" && runSuggest()}
            />
            <button type="button" class="{ghostBtn} border-slate-300 shrink-0" data-testid="rag-suggest"
              disabled={suggesting || suggestBase.trim().length === 0} onclick={runSuggest}>
              {suggesting ? "Exploring…" : "Suggest"}
            </button>
          </div>
          {#if suggestions}
            {#if suggestions.length === 0}
              <div class="text-muted-foreground" data-testid="rag-suggest-empty">Nothing indexable found under that base.</div>
            {:else}
              <div class="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-2" data-testid="rag-suggestions">
                {#each suggestions as c (c.path)}
                  <label class="flex items-start gap-2" data-testid="rag-suggestion" data-suggest-rel={c.relative || "."}>
                    <input type="checkbox"
                      checked={suggestPicked[c.path] ?? false}
                      onchange={(e) => (suggestPicked = { ...suggestPicked, [c.path]: e.currentTarget.checked })} />
                    <span class="min-w-0">
                      <code class="text-foreground">{c.relative || "."}</code>
                      <span class="text-muted-foreground"> · {c.files} files</span>
                      {#if c.reason}
                        <span class={c.recommended ? "text-teal-600" : "text-muted-foreground"} data-testid="rag-suggestion-reason"> · {c.reason}</span>
                      {/if}
                      <span class="block truncate text-[10px] text-muted-foreground">{c.samples.join(", ")}</span>
                    </span>
                  </label>
                {/each}
                <div>
                  <button type="button" class="{ghostBtn} border-slate-300" data-testid="rag-suggest-add" onclick={addPickedRoots}>
                    Add selected to roots
                  </button>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">Knowledge graph</span>
        <select class={inputClass} data-testid="rag-graph-builder" bind:value={graphBuilder}>
          <option value="">None</option>
          {#each graphBuilders as b (b.type)}
            <option value={b.type}>{b.label}</option>
          {/each}
        </select>
      </label>
      <label class="flex items-center gap-1.5 self-end pb-1.5 text-xs text-foreground">
        <input type="checkbox" data-testid="rag-watch" bind:checked={watchNew} />
        <span class="font-semibold">Watch sources</span>
        <span class="text-muted-foreground">(auto-index on change)</span>
      </label>
      {#if graphBuilder === "llm"}
        <div class="grid grid-cols-2 gap-2.5">
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">Extraction provider id</span>
            <input class={inputClass} data-testid="rag-graph-provider" bind:value={graphProviderId} placeholder="openai / lmstudio" />
          </label>
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">Extraction model</span>
            <input class={inputClass} data-testid="rag-graph-model" bind:value={graphModel} placeholder="gpt-4o-mini" />
          </label>
        </div>
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
        {@const indexing = indexingTasks.get(storage.id)}
        <section class="rounded-lg border border-border bg-card p-3" data-testid="rag-storage" data-storage-name={storage.name}>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <div class="text-sm font-bold text-foreground" data-testid="rag-storage-name">{storage.name}</div>
                {#if storage.watch}
                  <span
                    class="rounded bg-teal-500/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-teal-600"
                    title="Auto-indexes when the source changes"
                    data-testid="rag-watch-badge">watching</span>
                {/if}
              </div>
              <div class="text-xs text-muted-foreground" data-testid="rag-storage-meta">
                <code>{storage.entitySource}</code> · {storage.embeddingProviderId}/{storage.embeddingModel}
                {#if storage.embeddingDim}· {storage.embeddingDim}d{/if}
                · {storage.counts.chunks} chunks / {storage.counts.sources} sources
                {#if storage.graph}· graph ({storage.graph.builder}): {storage.counts.nodes} nodes / {storage.counts.edges} edges{/if}
                {#if storage.lastIngestedAt}· ingested {new Date(storage.lastIngestedAt).toLocaleString()}{:else}· never ingested{/if}
              </div>
              <div class="mt-0.5 text-[11px] text-muted-foreground">id: <code>{storage.id}</code></div>
            </div>
            <div class="flex shrink-0 gap-2">
              <button
                type="button"
                class="{ghostBtn} border-slate-300"
                data-testid="rag-watch-toggle"
                title={storage.watch ? "Stop watching sources" : "Auto-index when sources change"}
                disabled={busyId === storage.id}
                onclick={() => toggleWatch(storage)}
              >
                {storage.watch ? "Unwatch" : "Watch"}
              </button>
              <button type="button" class="{ghostBtn} border-slate-300" data-testid="rag-ingest" disabled={busyId === storage.id || !!indexing} onclick={() => ingest(storage.id)}>
                {indexing ? "Indexing…" : busyId === storage.id ? "Working…" : "Ingest"}
              </button>
              <button type="button" class="{ghostBtn} border-destructive/40 text-destructive" data-testid="rag-delete" disabled={busyId === storage.id || !!indexing} onclick={() => remove(storage.id)}>
                Delete
              </button>
            </div>
          </div>

          {#if indexing}
            <div
              class="mt-2 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs text-primary"
              data-testid="rag-indexing"
            >
              <Icon name="loader" class="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2.2} />
              <span class="font-medium">Indexing{indexing.meta.trigger === "watch" ? " (source changed)" : ""}…</span>
              {#if indexing.progress}
                <span class="tabular-nums text-primary/80" data-testid="rag-indexing-progress">{indexing.progress}</span>
              {/if}
              <button
                type="button"
                class="ml-auto rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                onclick={() => cancelIndexing(indexing.id)}
              >
                {indexing.status === "cancelling" ? "Cancelling…" : "Cancel"}
              </button>
            </div>
          {/if}

          {#if ingestResults[storage.id]}
            {@const r = ingestResults[storage.id]}
            <div class="mt-2 text-xs text-muted-foreground" data-testid="rag-ingest-result">
              Ingest: +{r.added} added · {r.updated} updated · {r.skipped} skipped · {r.removed} removed
              {#if r.graph}· graph: {r.graph.nodes} nodes / {r.graph.edges} edges{#if r.graph.failedSources > 0}
                  · {r.graph.failedSources} extraction failures{/if}{/if}
            </div>
          {/if}

          <div class="mt-2.5 flex items-center gap-2">
            <input
              class={inputClass}
              data-testid="rag-query"
              placeholder="Test query…"
              value={queryText[storage.id] ?? ""}
              oninput={(e) => (queryText = { ...queryText, [storage.id]: e.currentTarget.value })}
              onkeydown={(e) => e.key === "Enter" && runQuery(storage.id)}
            />
            <input
              class="{inputClass} w-14 shrink-0"
              type="number"
              min="1"
              max="50"
              title="top k"
              data-testid="rag-query-topk"
              value={queryTopK[storage.id] ?? 8}
              oninput={(e) => (queryTopK = { ...queryTopK, [storage.id]: Number(e.currentTarget.value) })}
            />
            {#if storage.graph}
              <label class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" data-testid="rag-query-graph"
                  checked={queryUseGraph[storage.id] ?? false}
                  onchange={(e) => (queryUseGraph = { ...queryUseGraph, [storage.id]: e.currentTarget.checked })} />
                graph
              </label>
            {/if}
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
                  <li class="rounded-md border border-border bg-muted/40 p-2 text-xs" data-testid="rag-hit" data-hit-origin={hit.origin}>
                    <div class="mb-0.5 flex justify-between gap-2 text-muted-foreground">
                      <code class="truncate" data-testid="rag-hit-source">{String(hit.metadata.relativePath ?? hit.sourceId)}</code>
                      <span class="flex shrink-0 items-center gap-1.5">
                        {#if hit.origin === "graph"}
                          <span class="rounded bg-primary/15 px-1 font-semibold text-primary" data-testid="rag-hit-origin">graph</span>
                        {/if}
                        {hit.score.toFixed(4)}
                      </span>
                    </div>
                    <div class="line-clamp-3 whitespace-pre-wrap text-foreground">{hit.text}</div>
                  </li>
                {/each}
              </ol>
            {/if}
            {#if queryGraphs[storage.id]}
              {@const g = queryGraphs[storage.id]!}
              <div class="mt-2 rounded-md border border-border bg-muted/40 p-2 text-xs" data-testid="rag-graph-context">
                <div class="mb-1 font-semibold text-foreground">Graph context</div>
                <ul class="flex flex-col gap-0.5 text-muted-foreground">
                  {#each g.relations as rel, i (i)}
                    <li data-testid="rag-graph-relation">
                      <span class="text-foreground">{rel.source}</span> —{rel.relation}→
                      <span class="text-foreground">{rel.target}</span>
                      {#if rel.description}<span> · {rel.description}</span>{/if}
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</main>
