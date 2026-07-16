<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { previewAllContextFiles } from "@/api/contextInjectionClient";
  import { createAgentsQuery } from "@/hooks/queries/referenceData";
  import {
    chatToolDraftRevision,
    getChatContextFilesDraft,
    setChatContextFilesDraft,
  } from "@/lib/chatToolDraft.svelte";
  import { readPreinjectConfig, seedPathsFromConfig } from "@/pages/settings/agentPreinject";
  import ContextFileList from "./ContextFileList.svelte";
  import KnowledgeSearchControls from "./KnowledgeSearchControls.svelte";
  import PlannerBaselineBlock from "./PlannerBaselineBlock.svelte";

  // New-conversation staging area (sibling of "Tool sandbox" and "Agent"):
  // everything the first message will carry. Files: instruction files (and
  // the root README) discovered in the SELECTED SANDBOX's workspace,
  // checkboxes seeded from the agent's preinject config — the first toggle
  // materializes the selection as a single-shot `overrides.contextFiles`
  // (config stays untouched). Knowledge: the same single-shot search controls
  // the composer offers on later messages. The live token/cost rollup lives
  // in the composer box below, next to the text it prices.
  let { agentId, toolSandboxId }: { agentId: string; toolSandboxId: string } = $props();

  const filesQuery = createQuery(() => ({
    queryKey: ["context-files-preview", "all", "env", toolSandboxId],
    queryFn: () => previewAllContextFiles({ toolSandboxId }),
    staleTime: 15_000,
  }));
  const preview = $derived(filesQuery.data);
  const candidates = $derived(preview?.files ?? []);

  const agentsQuery = createAgentsQuery();
  const agentConfig = $derived.by(() => {
    const agent = (agentsQuery.data ?? []).find((a) => a.id === agentId);
    return readPreinjectConfig(agent?.default_llm_configuration ?? null);
  });

  const filesDraft = $derived.by(() => {
    void $chatToolDraftRevision;
    return getChatContextFilesDraft();
  });
  /** Untouched = the agent config's set; touched = the user's explicit picks. */
  const selectedPaths = $derived(
    filesDraft.touched ? filesDraft.paths : seedPathsFromConfig(candidates, agentConfig),
  );
  const selectedTokens = $derived(
    candidates.filter((f) => selectedPaths.includes(f.path)).reduce((sum, f) => sum + (f.tokens ?? 0), 0),
  );

  function toggle(path: string): void {
    const next = selectedPaths.includes(path)
      ? selectedPaths.filter((p) => p !== path)
      : [...selectedPaths, path];
    setChatContextFilesDraft({ paths: next, touched: true });
  }
</script>

<div class="mt-4" data-testid="start-context-section">
  <div class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
    Start context
    <span class="font-normal">— carried by the first message</span>
  </div>
  <div class="rounded-xl border border-border bg-card/40 p-2.5">
    <div class="flex items-center gap-1.5">
      <span class="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
        <svg class="h-3 w-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        Context files
      </span>
      <a
        href="/settings/agents?agent={encodeURIComponent(agentId)}"
        class="text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        title="The checkboxes default to this agent's setting; edit it there to change every new conversation"
      >
        agent default ↗
      </a>
      {#if selectedPaths.length > 0}
        <span class="ml-auto text-[11px] font-normal tabular-nums text-muted-foreground" data-testid="start-context-tokens">
          {selectedPaths.length} selected · ~{selectedTokens} tok
        </span>
      {/if}
    </div>
    <div class="mt-1">
      {#if filesQuery.isPending}
        <p class="text-[11px] text-muted-foreground">scanning workspace…</p>
      {:else if filesQuery.isError}
        <p class="text-[11px] text-muted-foreground">files preview failed</p>
      {:else if preview && !preview.scannable}
        <p class="text-[11px] text-muted-foreground" data-testid="start-context-note">
          {preview.unavailableReason === "remote-sandbox"
            ? "This sandbox runs on a remote host — its workspace can't be scanned for context files yet."
            : "No sandbox — there is no workspace to scan for context files."}
        </p>
      {:else if candidates.length === 0}
        <p class="text-[11px] text-muted-foreground" data-testid="start-context-note">
          No instruction files (CLAUDE.md, AGENTS.md, .cursorrules, …) or README found in the workspace.
        </p>
      {:else}
        <ContextFileList files={candidates} selectable selectedPaths={selectedPaths} onToggle={toggle} />
      {/if}
    </div>

    <div class="my-1.5 h-px bg-border/60" aria-hidden="true"></div>

    <KnowledgeSearchControls />

    <div class="my-1.5 h-px bg-border/60" aria-hidden="true"></div>

    <PlannerBaselineBlock {agentId} />

    <p class="mt-1.5 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
      Files and searches are injected with the first message only — the send total appears in the message box
      below. Later messages can attach files and searches from the composer's Context panel.
    </p>
  </div>
</div>
