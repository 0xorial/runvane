<script lang="ts">
  import { onMount } from "svelte";
  import {
    createRagStorage,
    deleteRagStorage,
    getRagGraphBuilders,
    getRagSources,
    getRagStorages,
    getRagStorageLog,
    ingestRagStorage,
    queryRagStorage,
    updateRagStorage,
    type CreateRagStorageInput,
    type EntitySourceInfo,
    type GraphBuilderInfo,
    type IngestResult,
    type RagGraphContext,
    type RagLogEntry,
    type RagQueryHit,
    type RagStorageInfo,
  } from "@/api/ragClient";
  import { cancelTask, getLlmSettings } from "@/api/client";
  import { ensureTasksStream, getTasksSnapshot } from "@/lib/tasksStore.svelte";
  import type { TaskInfo } from "../../../../backend/src/contracts/task";
  import Icon from "@/components/ui/Icon.svelte";
  import { ghostBtn } from "./settingsClasses";

  let storages = $state<RagStorageInfo[]>([]);
  let sources = $state<EntitySourceInfo[]>([]);
  let graphBuilders = $state<GraphBuilderInfo[]>([]);
  // Configured providers + their verified model lists, for input suggestions.
  let llmProviders = $state<Array<{ id: string; models: string[] }>>([]);
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
  let showCreate = $state(false);

  // Per-storage transient UI state.
  let busyId = $state<string | null>(null);
  let ingestResults = $state<Record<string, IngestResult>>({});
  let queryText = $state<Record<string, string>>({});
  let queryTopK = $state<Record<string, number>>({});
  let queryUseGraph = $state<Record<string, boolean>>({});
  let queryHits = $state<Record<string, RagQueryHit[]>>({});
  let queryGraphs = $state<Record<string, RagGraphContext | null>>({});
  let logOpen = $state<Record<string, boolean>>({});
  let logEntries = $state<Record<string, RagLogEntry[]>>({});

  const canCreate = $derived(
    name.trim().length > 0 &&
      providerId.trim().length > 0 &&
      model.trim().length > 0 &&
      (entitySource !== "files" || rootsText.trim().length > 0) &&
      (graphBuilder === "" || (graphProviderId.trim().length > 0 && graphModel.trim().length > 0)),
  );

  const inputClass =
    "w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground";

  const modelsFor = (providerId: string): string[] =>
    llmProviders.find((p) => p.id === providerId.trim())?.models ?? [];
  const embeddingModelOptions = $derived(modelsFor(providerId));
  const graphModelOptions = $derived(modelsFor(graphProviderId));

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const [nextStorages, nextSources, nextBuilders, llmSettings] = await Promise.all([
        getRagStorages(),
        getRagSources(),
        getRagGraphBuilders(),
        getLlmSettings().catch(() => null), // suggestions only — never block the page
      ]);
      storages = nextStorages;
      sources = nextSources;
      graphBuilders = nextBuilders;
      if (llmSettings) {
        llmProviders = llmSettings.providers.map((p) => ({
          id: p.id,
          models: Array.isArray(p.models) ? p.models : [],
        }));
      }
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

  // With nothing to list yet the collapsed form is a pointless extra click, so
  // it starts open (also when the last storage is deleted).
  $effect(() => {
    if (!loading && storages.length === 0) showCreate = true;
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
        // Both builders (llm, lightrag) take the same provider/model params.
        graph: graphBuilder
          ? {
              builder: graphBuilder,
              params: { providerId: graphProviderId.trim(), model: graphModel.trim() },
            }
          : null,
        watch: watchNew,
      };
      await createRagStorage(input);
      name = "";
      rootsText = "";
      graphBuilder = "";
      watchNew = false;
      showCreate = false;
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

  async function toggleLog(id: string): Promise<void> {
    const next = !logOpen[id];
    logOpen = { ...logOpen, [id]: next };
    if (!next) return;
    try {
      logEntries = { ...logEntries, [id]: (await getRagStorageLog(id)).entries };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  /** One human line per log entry; the interesting keys per event, in order. */
  function logSummary(entry: RagLogEntry): string {
    const d = entry.detail;
    switch (entry.event) {
      case "created":
        return `embedding ${d.embedding}${d.graph ? ` · graph ${d.graph}` : ""}${d.watch ? " · watching" : ""}`;
      case "ingest":
        return (
          `+${d.added} ~${d.updated} =${d.skipped} -${d.removed} · ${d.total_chunks} chunks` +
          (d.nodes !== undefined ? ` · ${d.nodes} nodes/${d.edges} edges` : "") +
          (Number(d.graph_failures) > 0 ? ` · ${d.graph_failures} graph failures` : "") +
          (Number(d.graph_llm_calls) > 0
            ? ` · ${d.graph_llm_calls} LLM calls/${d.graph_tokens} tok` +
              (d.graph_cost_usd !== undefined ? `/$${Number(d.graph_cost_usd).toFixed(4)}` : "")
            : "") +
          ` · ${((Number(d.duration_ms) || 0) / 1000).toFixed(1)}s`
        );
      case "ingest_failed":
        return String(d.error ?? "failed");
      case "source_added":
        return `${(Array.isArray(d.roots) ? d.roots : []).join(", ")} · chat ${String(d.conversation_id ?? "").slice(0, 8)}`;
      case "watch_changed":
        return d.watch ? "watching on" : "watching off";
      default:
        return "";
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

  <!-- List -->
  {#if loading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else if storages.length === 0}
    <p class="text-sm text-muted-foreground" data-testid="rag-empty">No storages yet. Create one below, then ingest it.</p>
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
                data-testid="rag-log-toggle"
                title="Activity log: who changed this storage, when, with what stats"
                onclick={() => toggleLog(storage.id)}
              >
                Log
              </button>
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

          {#if logOpen[storage.id]}
            <div class="mt-2 rounded-md border border-border bg-muted/40 p-2 text-xs" data-testid="rag-log">
              {#if !logEntries[storage.id]}
                <span class="text-muted-foreground">Loading…</span>
              {:else if logEntries[storage.id].length === 0}
                <span class="text-muted-foreground">No activity yet.</span>
              {:else}
                <ul class="flex flex-col gap-1">
                  {#each logEntries[storage.id] as entry (entry.id)}
                    <li class="flex items-baseline gap-2" data-testid="rag-log-entry" data-log-event={entry.event} data-log-actor={entry.actor}>
                      <span class="shrink-0 tabular-nums text-muted-foreground">{new Date(entry.at).toLocaleString()}</span>
                      <span
                        class="shrink-0 rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide {entry.actor === 'agent'
                          ? 'bg-violet-500/15 text-violet-600'
                          : entry.actor === 'watcher'
                            ? 'bg-teal-500/15 text-teal-600'
                            : 'bg-slate-500/15 text-slate-600'}"
                      >
                        {entry.actor}
                      </span>
                      <span class="shrink-0 font-medium text-foreground">{entry.event.replace("_", " ")}</span>
                      <span class="min-w-0 truncate text-muted-foreground" title={logSummary(entry)}>{logSummary(entry)}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}

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
                  · {r.graph.failedSources} extraction failures{/if}{#if r.graph.llmCalls > 0}
                  · {r.graph.llmCalls} LLM calls / {r.graph.promptTokens + r.graph.completionTokens} tok{#if r.graph.costUsd !== null}
                    / ${r.graph.costUsd.toFixed(4)}{/if}{/if}{/if}
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

  <!-- Create -->
  {#if !showCreate}
    <div>
      <button type="button" class={ghostBtn} data-testid="rag-add" onclick={() => (showCreate = true)}>
        + Add storage
      </button>
    </div>
  {:else}
  <section class="rounded-lg border border-border bg-card p-3">
    <div class="mb-2 flex items-center justify-between">
      <div class="text-[13px] font-bold text-foreground">New storage</div>
      {#if storages.length > 0}
        <button type="button" class="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Close new-storage form" onclick={() => (showCreate = false)}>
          ✕
        </button>
      {/if}
    </div>
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
        <input class={inputClass} data-testid="rag-provider" bind:value={providerId} placeholder="openai / lmstudio" list="rag-provider-options" />
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">Embedding model</span>
        <input class={inputClass} data-testid="rag-model" bind:value={model} placeholder="text-embedding-3-small" list="rag-embed-model-options" />
      </label>
      <datalist id="rag-provider-options">
        {#each llmProviders as p (p.id)}<option value={p.id}></option>{/each}
      </datalist>
      <datalist id="rag-embed-model-options">
        {#each embeddingModelOptions as m (m)}<option value={m}></option>{/each}
      </datalist>
      {#if entitySource === "files"}
        <label class="col-span-2 flex flex-col gap-1 text-xs">
          <span class="font-semibold text-foreground">Roots (one absolute path per line)</span>
          <textarea class="{inputClass} min-h-[64px] resize-y font-mono" data-testid="rag-roots" bind:value={rootsText}
            placeholder={"/workspace/docs\n/workspace/backend/src"}></textarea>
        </label>
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
      {#if graphBuilder === "lightrag"}
        <p class="col-span-2 -mt-1 text-[11px] text-muted-foreground" data-testid="rag-lightrag-hint">
          Runs the LightRAG library locally as a Python sidecar. Needs <code>python3</code> (≥3.10) on the
          backend; the first ingest bootstraps a private venv once (~1 min). The provider must be
          OpenAI-compatible.
        </p>
      {/if}
      {#if graphBuilder !== ""}
        <div class="grid grid-cols-2 gap-2.5">
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">Extraction provider id</span>
            <input class={inputClass} data-testid="rag-graph-provider" bind:value={graphProviderId} placeholder="openai / lmstudio" list="rag-provider-options" />
          </label>
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">Extraction model</span>
            <input class={inputClass} data-testid="rag-graph-model" bind:value={graphModel} placeholder="gpt-4o-mini" list="rag-graph-model-options" />
          </label>
          <datalist id="rag-graph-model-options">
            {#each graphModelOptions as m (m)}<option value={m}></option>{/each}
          </datalist>
        </div>
      {/if}
    </div>
    <div class="mt-2.5">
      <button type="button" class="{ghostBtn} border-slate-300" data-testid="rag-create" disabled={!canCreate || creating} onclick={create}>
        {creating ? "Creating…" : "Create storage"}
      </button>
    </div>
  </section>
  {/if}
</main>
