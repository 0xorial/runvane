<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import type { LlmRef } from "../../../../backend/src/contracts/llm";
  import { previewAllContextFiles } from "@/api/contextInjectionClient";
  import { previewForcedRetrieval, type RetrievePreviewResult } from "@/api/knowledgeClient";
  import {
    chatToolDraftRevision,
    getChatContextFilesDraft,
    getChatKnowledgeDraft,
    setChatContextFilesDraft,
  } from "@/lib/chatToolDraft.svelte";
  import { estimateAttachmentTokens, estimateTextTokens } from "@/lib/sendEstimate";
  import { formatCostUsd } from "@/lib/providerCost";
  import { getLiveModelPricing } from "@/api/client";
  import { createAgentsQuery, createModelCapabilitiesQuery, pricingFromCapabilities } from "@/hooks/queries/referenceData";
  import { queryKeys } from "@/hooks/queries/keys";
  import { getAgentLlm } from "@/pages/settings/agentLlm";
  import { readPreinjectConfig, seedPathsFromConfig } from "@/pages/settings/agentPreinject";
  import type { SelectedAttachment } from "./AttachmentChips.svelte";
  import ContextFileList from "./ContextFileList.svelte";
  import KnowledgeSearchControls from "./KnowledgeSearchControls.svelte";

  const CHIP_HINT =
    "Everything auto-injected with this send: context files and any knowledge-base search you enable " +
    "for this message.";

  let {
    text,
    agentId,
    conversationId,
    toolSandboxId = "",
    attachments = [],
    llm = null,
  }: {
    /** The message being composed — drives the live previews and the estimate. */
    text: string;
    /** The agent this send would use — its config seeds the files selection. */
    agentId: string;
    /** Null while composing the first message: staging then lives in the
     *  Start context section, and this bar reduces to the estimate line. */
    conversationId: string | null;
    /** The sandbox a NEW conversation would bind (?env=) — scopes the files
     *  scan pre-creation; existing conversations use their bound sandbox. */
    toolSandboxId?: string;
    /** Uploads staged in the composer — priced into the estimate. */
    attachments?: SelectedAttachment[];
    /** Explicit model override from the toolbar; null = the agent's default. */
    llm?: LlmRef | null;
  } = $props();

  let open = $state(false);

  const firstMessage = $derived(!conversationId);

  // ---- Files half ----
  // One shared candidate list (?all=1). First message: the selection is the
  // Start context section's — seeded from the agent config until touched.
  // Later messages: the panel's explicit attach picker.

  const filesDraft = $derived.by(() => {
    void $chatToolDraftRevision;
    return getChatContextFilesDraft();
  });

  const candidatesQuery = createQuery(() => ({
    queryKey: firstMessage
      ? (["context-files-preview", "all", "env", toolSandboxId] as const)
      : (["context-files-preview", "all", "conv", conversationId] as const),
    queryFn: () =>
      previewAllContextFiles(firstMessage ? { toolSandboxId } : { conversationId: conversationId ?? undefined }),
    enabled: firstMessage ? Boolean(agentId) : open || filesDraft.touched || filesDraft.paths.length > 0,
    staleTime: 15_000,
  }));
  const candidatesPreview = $derived(candidatesQuery.data);
  const candidates = $derived(candidatesPreview?.files ?? []);

  const agentsQuery = createAgentsQuery();
  const agentConfig = $derived.by(() => {
    const agent = (agentsQuery.data ?? []).find((a) => a.id === agentId);
    return readPreinjectConfig(agent?.default_llm_configuration ?? null);
  });

  const selectedFilePaths = $derived.by(() => {
    if (filesDraft.touched) return filesDraft.paths;
    return firstMessage ? seedPathsFromConfig(candidates, agentConfig) : [];
  });
  const filesTokens = $derived(
    candidates.filter((f) => selectedFilePaths.includes(f.path)).reduce((sum, f) => sum + (f.tokens ?? 0), 0),
  );

  function toggleAttachPath(path: string): void {
    const next = selectedFilePaths.includes(path)
      ? selectedFilePaths.filter((p) => p !== path)
      : [...selectedFilePaths, path];
    setChatContextFilesDraft({ paths: next, touched: true });
  }

  // ---- Knowledge half (draft-driven; controls live in KnowledgeSearchControls) ----

  const draft = $derived.by(() => {
    void $chatToolDraftRevision;
    return getChatKnowledgeDraft();
  });
  const splitMode = $derived(draft.mode === "preplanned");

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
  // queries only exist at send time, so no preview is attempted. Runs for the
  // first message too — the Start context section sets the draft, and the
  // estimate here prices it.
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

  /** The send's model: explicit toolbar override, else the agent's default —
   *  drives family-specific attachment costing and the $ estimate. */
  const selectedLlm = $derived.by(() => {
    if (llm?.model) return { providerId: llm.providerId, model: llm.model.trim() };
    const agent = (agentsQuery.data ?? []).find((a) => a.id === agentId);
    if (!agent) return { providerId: "", model: "" };
    const agentLlm = getAgentLlm(agent);
    return { providerId: agentLlm.provider_id.trim(), model: agentLlm.model.trim() };
  });

  const messageTokens = $derived(estimateTextTokens(text.trim()));
  const attachmentEst = $derived(estimateAttachmentTokens(attachments, selectedLlm.model));

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
  const anythingActive = $derived(selectedFilePaths.length > 0 || draft.enabled);
  const showTotal = $derived(anythingActive || text.trim().length > 0 || attachments.length > 0);

  // Pricing rates: capability overrides first, then the provider's live
  // catalog (e.g. OpenRouter publishes per-token pricing with its model list).
  const capabilitiesQuery = createModelCapabilitiesQuery();
  const pricingByModel = $derived(pricingFromCapabilities(capabilitiesQuery.data));
  const capabilityPricing = $derived(selectedLlm.model ? pricingByModel.get(selectedLlm.model) : undefined);
  const livePricingQuery = createQuery(() => ({
    queryKey: queryKeys.liveModelPricing(selectedLlm.providerId),
    queryFn: () => getLiveModelPricing(selectedLlm.providerId),
    enabled: Boolean(selectedLlm.providerId) && Boolean(selectedLlm.model) && !capabilityPricing,
    staleTime: 60 * 60 * 1000,
  }));
  const modelPricing = $derived(
    capabilityPricing ?? (selectedLlm.model ? livePricingQuery.data?.pricing?.[selectedLlm.model] : undefined),
  );
  const costLabel = $derived.by(() => {
    if (totalKnown === 0 || !modelPricing) return "";
    return `≈${formatCostUsd((totalKnown / 1_000_000) * modelPricing.inCostPer1m)}`;
  });
  /** There is something to price and a model to price it with, but no rate
   *  anywhere (capability overrides and live catalog both came up empty) —
   *  offer the fix instead of silently showing tokens only. */
  const pricingMissing = $derived(
    totalKnown > 0 &&
      Boolean(selectedLlm.model) &&
      !modelPricing &&
      capabilitiesQuery.data !== undefined &&
      !livePricingQuery.isLoading,
  );

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
    if (selectedFilePaths.length > 0) {
      parts.push(`${selectedFilePaths.length} attached file${selectedFilePaths.length === 1 ? "" : "s"}`);
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
  const noteText = "text-[11px] text-muted-foreground";
</script>

{#snippet estimateLine()}
  <span class="ml-auto flex shrink-0 items-center gap-1.5 pr-1">
    <span class="text-[11px] tabular-nums text-muted-foreground" title={totalTitle} data-testid="chat-context-total">
      {totalLabel}
    </span>
    {#if pricingMissing}
      <a
        href="/settings/model-pricing?focus={encodeURIComponent(selectedLlm.model)}"
        class="text-[11px] text-primary underline-offset-4 hover:underline"
        data-testid="set-price-link"
        title="No rate configured for {selectedLlm.model} — set one to see cost estimates"
      >
        set price ↗
      </a>
    {/if}
  </span>
{/snippet}

{#snippet knowledgeHeaderRight()}
  {#if draft.enabled && draft.storages.length > 0}
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
{/snippet}

{#snippet excerptList()}
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
{/snippet}

<div class="px-0.5 {open && !firstMessage ? 'mb-0.5 border-b border-border/60 pb-1' : 'pb-0.5'}" data-testid="chat-context-bar">
  {#if firstMessage}
    <!-- Staging lives in the Start context section above; the box only prices the send. -->
    {#if totalLabel}
      <div class="flex items-center">
        {@render estimateLine()}
      </div>
    {/if}
  {:else}
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
        {@render estimateLine()}
      {/if}
    </div>

    {#if open}
      <div class="mt-1 overflow-hidden rounded-md ring-1 ring-border/60" data-testid="chat-context-panel">
        <!-- ===== Files: explicit per-message attach ===== -->
        <section class="px-2 py-1.5" data-testid="context-files-section">
          <div class="flex items-center gap-1.5">
            <span
              class="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground"
              title="Workspace files folded into the planner with this message (the conversation got its start context with its first message)."
            >
              <svg class="h-3 w-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              Context files
            </span>
            {#if selectedFilePaths.length > 0}
              <span class="ml-auto text-[11px] tabular-nums text-muted-foreground" data-testid="context-files-tokens">
                {selectedFilePaths.length} selected · ~{filesTokens} tok
              </span>
            {/if}
          </div>
          <div class="mt-1 space-y-px">
            {#if candidatesQuery.isPending}
              <p class={noteText} data-testid="context-files-note">scanning workspace…</p>
            {:else if candidatesQuery.isError}
              <p class={noteText} data-testid="context-files-note">files preview failed</p>
            {:else if candidatesPreview && !candidatesPreview.scannable}
              <p class={noteText} data-testid="context-files-note">
                {candidatesPreview.unavailableReason === "remote-sandbox"
                  ? "This conversation's sandbox runs on a remote host — its workspace can't be scanned for context files yet."
                  : "This conversation has no sandbox — there is no workspace to scan for context files."}
              </p>
            {:else if candidates.length === 0}
              <p class={noteText} data-testid="context-files-note">
                No instruction files (CLAUDE.md, AGENTS.md, .cursorrules, …) or README found in the workspace.
              </p>
            {:else}
              <ContextFileList
                files={candidates}
                selectable
                selectedPaths={selectedFilePaths}
                onToggle={toggleAttachPath}
              />
              <p class="pt-0.5 {noteText}">Checked files are folded in with this message only.</p>
            {/if}
          </div>
        </section>

        <div class="h-px bg-border/60" aria-hidden="true"></div>

        <!-- ===== Knowledge: single-shot forced retrieval for this message ===== -->
        <section class="px-2 py-1.5">
          <KnowledgeSearchControls headerRight={knowledgeHeaderRight} children={excerptList} />
        </section>
      </div>
    {/if}
  {/if}
</div>
