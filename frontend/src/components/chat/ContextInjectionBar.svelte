<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import type { LlmRef } from "../../../../backend/src/contracts/llm";
  import {
    previewAllContextFiles,
    previewContextFiles,
    type PreinjectPreviewResult,
  } from "@/api/contextInjectionClient";
  import { getKnowledgeStorages, previewForcedRetrieval, type RetrievePreviewResult } from "@/api/knowledgeClient";
  import {
    chatToolDraftRevision,
    getChatContextFilesDraft,
    getChatKnowledgeDraft,
    setChatContextFilesDraft,
    setChatKnowledgeDraft,
  } from "@/lib/chatToolDraft.svelte";
  import { estimateAttachmentTokens, estimateTextTokens } from "@/lib/sendEstimate";
  import { formatCostUsd } from "@/lib/providerCost";
  import { createAgentsQuery, createModelCapabilitiesQuery, pricingFromCapabilities } from "@/hooks/queries/referenceData";
  import { getAgentLlm } from "@/pages/settings/agentLlm";
  import type { SelectedAttachment } from "./AttachmentChips.svelte";
  import ContextFileList from "./ContextFileList.svelte";

  const CHIP_HINT =
    "Everything auto-injected with this send: context files (agent-configured at conversation start, " +
    "or attached per message) and any knowledge-base search you enable for this message.";
  const KNOWLEDGE_HINT =
    "Single-shot: pulls context from the selected knowledge bases before the agent plans this " +
    "message, records it in the transcript, and switches off after sending.";

  const TOP_K_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
  const DEFAULT_TOP_K = 8;

  let {
    text,
    agentId,
    conversationId,
    attachments = [],
    llm = null,
  }: {
    /** The message being composed — drives the live previews and the estimate. */
    text: string;
    /** The agent this send would use — drives the files-scan preview. */
    agentId: string;
    /** Null while composing the first message (the auto files scan fires then). */
    conversationId: string | null;
    /** Uploads staged in the composer — priced into the estimate. */
    attachments?: SelectedAttachment[];
    /** Explicit model override from the toolbar; null = the agent's default. */
    llm?: LlmRef | null;
  } = $props();

  let open = $state(false);

  // ---- Files half ----
  // First message: the agent-config scan runs automatically (rows are listed in
  // the Start context section above the composer; here it only feeds the
  // estimate). Later messages: an explicit per-message attach picker over the
  // full candidate list (`overrides.contextFiles`).

  const firstMessage = $derived(!conversationId);

  const autoFilesQuery = createQuery(() => ({
    queryKey: ["context-files-preview", agentId],
    queryFn: () => previewContextFiles(agentId),
    enabled: Boolean(agentId) && firstMessage,
    staleTime: 15_000,
  }));
  const autoFiles = $derived<PreinjectPreviewResult | undefined>(
    firstMessage && agentId ? autoFilesQuery.data : undefined,
  );
  const autoInjectedCount = $derived((autoFiles?.files ?? []).filter((f) => f.status === "injected").length);
  const autoTokens = $derived(autoFiles?.totalTokens ?? 0);

  const filesDraft = $derived.by(() => {
    void $chatToolDraftRevision;
    return getChatContextFilesDraft();
  });

  const attachQuery = createQuery(() => ({
    queryKey: ["context-files-preview", "all"],
    queryFn: previewAllContextFiles,
    enabled: !firstMessage && (open || filesDraft.paths.length > 0),
    staleTime: 15_000,
  }));
  const attachCandidates = $derived(!firstMessage ? (attachQuery.data?.files ?? []) : []);
  const attachTokens = $derived(
    attachCandidates.filter((f) => filesDraft.paths.includes(f.path)).reduce((sum, f) => sum + (f.tokens ?? 0), 0),
  );

  function toggleAttachPath(path: string): void {
    const current = getChatContextFilesDraft();
    const next = current.paths.includes(path)
      ? current.paths.filter((p) => p !== path)
      : [...current.paths, path];
    setChatContextFilesDraft({ paths: next });
  }

  // ---- Knowledge half (single-shot forced retrieval) ----

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

  type Preview =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error" }
    | { status: "done"; hits: RetrievePreviewResult["hits"]; tokens: number };
  let preview = $state<Preview>({ status: "idle" });
  let previewSeq = 0;

  // Live feedback (Direct mode only): retrieval is cheap, so run the real
  // thing (same endpoint logic as the send path) debounced while the user
  // types, and show what a send right now would inject. In LLM-split mode the
  // queries only exist at send time, so no preview is attempted — the section
  // says "estimated at send" instead of pretending.
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
          preview = { status: "done", hits: result.hits, tokens: result.estimatedTokens };
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
    if (draft.storages.length === 0) return "pick a knowledge base";
    if (text.trim().length === 0) return "type to preview";
    if (preview.status === "loading") return "searching…";
    if (preview.status === "error") return "preview failed";
    if (preview.status === "done") {
      const noun = preview.hits.length === 1 ? "excerpt" : "excerpts";
      return preview.hits.length === 0
        ? `no matches · injects ~${preview.tokens} tok`
        : `${preview.hits.length} ${noun} · ~${preview.tokens} tok`;
    }
    return "";
  });

  let expandedExcerpt = $state<number | null>(null);

  function toggleExcerptRow(index: number): void {
    expandedExcerpt = expandedExcerpt === index ? null : index;
  }

  // ---- Send estimate (message + attachments + files + knowledge → tokens/$) ----

  const messageTokens = $derived(estimateTextTokens(text.trim()));
  const attachmentEst = $derived(estimateAttachmentTokens(attachments));
  const filesTokens = $derived(firstMessage ? autoTokens : attachTokens);

  const knowledgeSelected = $derived(draft.enabled && draft.storages.length > 0);
  /** Direct-mode tokens once previewed; null while the amount is still unknown
   *  (typing/loading, or LLM-split where queries only exist at send time). */
  const knowledgeTokens = $derived.by(() => {
    if (!knowledgeSelected) return 0;
    if (!splitMode && preview.status === "done") return preview.tokens;
    return null;
  });

  const totalKnown = $derived(messageTokens + attachmentEst.tokens + filesTokens + (knowledgeTokens ?? 0));
  const totalPending = $derived(knowledgeTokens === null || attachmentEst.unknownCount > 0);
  const anythingActive = $derived(
    autoInjectedCount > 0 || draft.enabled || filesDraft.paths.length > 0,
  );
  const showTotal = $derived(anythingActive || text.trim().length > 0 || attachments.length > 0);

  // Pricing: explicit toolbar override, else the agent's default model.
  const capabilitiesQuery = createModelCapabilitiesQuery();
  const agentsQuery = createAgentsQuery();
  const pricingByModel = $derived(pricingFromCapabilities(capabilitiesQuery.data));
  const modelName = $derived.by(() => {
    if (llm?.model) return llm.model.trim();
    const agent = (agentsQuery.data ?? []).find((a) => a.id === agentId);
    return agent ? getAgentLlm(agent).model.trim() : "";
  });
  const costLabel = $derived.by(() => {
    if (totalKnown === 0) return "";
    const pricing = modelName ? pricingByModel.get(modelName) : undefined;
    if (!pricing) return "";
    return `≈${formatCostUsd((totalKnown / 1_000_000) * pricing.inCostPer1m)}`;
  });

  const totalLabel = $derived.by(() => {
    if (!showTotal) return "";
    const tokens = totalPending
      ? totalKnown > 0
        ? `~${totalKnown} + ? tok`
        : "? tok"
      : `~${totalKnown} tok`;
    return costLabel ? `${tokens} · ${costLabel}` : tokens;
  });

  const totalTitle = $derived.by(() => {
    const parts = [`message ~${messageTokens} tok`];
    if (attachments.length > 0) {
      const unknown = attachmentEst.unknownCount > 0 ? ` + ${attachmentEst.unknownCount} at send` : "";
      parts.push(`attachments ~${attachmentEst.tokens} tok${unknown}`);
    }
    if (filesTokens > 0) parts.push(`context files ~${filesTokens} tok`);
    if (knowledgeSelected) parts.push(knowledgeTokens === null ? "knowledge at send" : `knowledge ~${knowledgeTokens} tok`);
    return parts.join(" · ");
  });

  const chipSummary = $derived.by(() => {
    const parts: string[] = [];
    if (firstMessage && autoInjectedCount > 0) {
      parts.push(`${autoInjectedCount} file${autoInjectedCount === 1 ? "" : "s"}`);
    }
    if (!firstMessage && filesDraft.paths.length > 0) {
      parts.push(`${filesDraft.paths.length} attached file${filesDraft.paths.length === 1 ? "" : "s"}`);
    }
    if (draft.enabled) {
      if (draft.storages.length === 0) parts.push("knowledge: pick a base");
      else if (splitMode) parts.push("knowledge @ send");
      else if (preview.status === "done") {
        parts.push(`${preview.hits.length} excerpt${preview.hits.length === 1 ? "" : "s"}`);
      } else parts.push("knowledge search");
    }
    return parts.length > 0 ? parts.join(" + ") : "nothing injected";
  });

  const chipBase =
    "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors";
  const segmentBase =
    "inline-flex h-5 shrink-0 items-center gap-1 px-2 text-[11px] font-medium transition-colors";
  const sectionTitle = "inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground";
  const noteText = "text-[11px] text-muted-foreground";
</script>

<div class="px-0.5 {open ? 'mb-0.5 border-b border-border/60 pb-1' : 'pb-0.5'}" data-testid="chat-context-bar">
  <!-- Collapsed row: chip + live rollup. Always answers "what does this send cost?" -->
  <div class="flex flex-wrap items-center gap-1.5">
    <button
      type="button"
      data-testid="chat-context-chip"
      aria-expanded={open}
      title={CHIP_HINT}
      onclick={() => (open = !open)}
      class="{chipBase} -ml-1 {anythingActive
        ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
        : 'bg-secondary/30 text-muted-foreground ring-1 ring-border/60 hover:bg-secondary/50 hover:text-foreground'}"
    >
      <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
      </svg>
      Context
      <svg
        class="h-2.5 w-2.5 transition-transform {open ? 'rotate-90' : ''}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
    <span class="text-[11px] text-muted-foreground" data-testid="chat-context-summary">{chipSummary}</span>
    {#if totalLabel}
      <span
        class="ml-auto pr-1 text-[11px] tabular-nums text-muted-foreground"
        title={totalTitle}
        data-testid="chat-context-total"
      >
        {totalLabel}
      </span>
    {/if}
  </div>

  {#if open}
    <div class="mt-1 overflow-hidden rounded-md ring-1 ring-border/60" data-testid="chat-context-panel">
      <!-- ===== Files: auto scan on the first message, explicit attach afterwards ===== -->
      <section class="px-2 py-1.5" data-testid="context-files-section">
        <div class="flex items-center gap-1.5">
          <span
            class={sectionTitle}
            title="Workspace files folded into the planner: automatically once per conversation (first message, per the agent's settings), or attached per message here."
          >
            <svg class="h-3 w-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            Context files
          </span>
          {#if agentId && firstMessage}
            <a
              href="/settings/agents?agent={encodeURIComponent(agentId)}"
              class="text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              title="Configure which file categories this agent injects"
            >
              configure ↗
            </a>
          {/if}
          {#if firstMessage && autoInjectedCount > 0}
            <span class="ml-auto text-[11px] tabular-nums text-muted-foreground" data-testid="context-files-tokens">
              ~{autoTokens} tok
            </span>
          {:else if !firstMessage && filesDraft.paths.length > 0}
            <span class="ml-auto text-[11px] tabular-nums text-muted-foreground" data-testid="context-files-tokens">
              {filesDraft.paths.length} selected · ~{attachTokens} tok
            </span>
          {/if}
        </div>
        <div class="mt-1 space-y-px">
          {#if firstMessage}
            {#if !agentId}
              <p class={noteText} data-testid="context-files-note">Pick an agent to preview its context files.</p>
            {:else if autoFilesQuery.isPending}
              <p class={noteText} data-testid="context-files-note">scanning workspace…</p>
            {:else if autoFilesQuery.isError}
              <p class={noteText} data-testid="context-files-note">files preview failed</p>
            {:else if autoFiles?.mode === "none"}
              <p class={noteText} data-testid="context-files-note">
                Off for this agent — nothing from the workspace is auto-injected.
              </p>
            {:else if autoInjectedCount === 0}
              <p class={noteText} data-testid="context-files-note">
                No candidate files (CLAUDE.md, README.md, package.json, …) found in the workspace.
              </p>
            {:else}
              <p class={noteText} data-testid="context-files-note">
                Listed under Start context above — injected once, with this first message.
              </p>
            {/if}
          {:else if attachQuery.isPending}
            <p class={noteText} data-testid="context-files-note">scanning workspace…</p>
          {:else if attachQuery.isError}
            <p class={noteText} data-testid="context-files-note">files preview failed</p>
          {:else if attachCandidates.length === 0}
            <p class={noteText} data-testid="context-files-note">
              No candidate files (CLAUDE.md, README.md, package.json, …) found in the workspace.
            </p>
          {:else}
            <ContextFileList
              files={attachCandidates}
              selectable
              selectedPaths={filesDraft.paths}
              onToggle={toggleAttachPath}
            />
            <p class="pt-0.5 {noteText}">
              Checked files are folded in with this message only (the conversation got its start context with
              its first message).
            </p>
          {/if}
        </div>
      </section>

      <div class="h-px bg-border/60" aria-hidden="true"></div>

      <!-- ===== Knowledge: single-shot forced retrieval for this message ===== -->
      <section class="px-2 py-1.5" data-testid="context-knowledge-section">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class={sectionTitle}>
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
          {#if draft.enabled && storages.length > 0}
            {#if splitMode}
              <span
                class="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                data-testid="retrieval-runtime-note"
              >
                <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
                </svg>
                estimated at send
              </span>
            {:else}
              <span class="ml-auto text-[11px] tabular-nums text-muted-foreground" data-testid="retrieval-preview">
                {previewLabel}
              </span>
            {/if}
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

              {#if !splitMode && preview.status === "done" && preview.hits.length > 0}
                <div class="space-y-px" data-testid="context-excerpt-list">
                  {#each preview.hits as hit, i (i)}
                    <div>
                      <button
                        type="button"
                        data-testid="context-excerpt-row"
                        aria-expanded={expandedExcerpt === i}
                        onclick={() => toggleExcerptRow(i)}
                        class="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] hover:bg-secondary/45"
                      >
                        <svg
                          class="h-2.5 w-2.5 shrink-0 text-muted-foreground transition-transform {expandedExcerpt === i
                            ? 'rotate-90'
                            : ''}"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                        <code class="min-w-0 truncate text-secondary-foreground">{hit.source}</code>
                        <span class="min-w-0 truncate text-muted-foreground">{hit.storage}</span>
                        <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">{hit.score}</span>
                      </button>
                      {#if expandedExcerpt === i}
                        <pre
                          data-testid="context-excerpt-text"
                          class="scrollbar-thin mx-1 mb-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground">{hit.text}</pre>
                      {/if}
                    </div>
                  {/each}
                </div>
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
                    before the agent plans. The counter on the right is the exact context injected.
                  {/if}
                </p>
              </div>
            {/if}
          </div>
        {:else}
          <p class="mt-1 {noteText}">Off — this message won't search any knowledge base.</p>
        {/if}
      </section>
    </div>
  {/if}
</div>
