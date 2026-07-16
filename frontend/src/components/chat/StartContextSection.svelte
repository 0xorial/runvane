<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { previewContextFiles } from "@/api/contextInjectionClient";
  import ContextFileList from "./ContextFileList.svelte";

  // New-conversation setup section (sibling of "Tool sandbox" and "Agent"):
  // what the selected agent will fold into the planner once, with the
  // conversation's first message. Read-only — the per-agent policy is edited
  // in agent settings; later messages can re-attach via the composer's
  // Context panel.
  let { agentId }: { agentId: string } = $props();

  const filesQuery = createQuery(() => ({
    queryKey: ["context-files-preview", agentId],
    queryFn: () => previewContextFiles(agentId),
    enabled: Boolean(agentId),
    staleTime: 15_000,
  }));
  const preview = $derived(filesQuery.data);
  const injectedCount = $derived((preview?.files ?? []).filter((f) => f.status === "injected").length);
</script>

<div class="mt-4" data-testid="start-context-section">
  <div class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
    Start context
    <a
      href="/settings/agents?agent={encodeURIComponent(agentId)}"
      class="font-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      title="Configure which file categories this agent injects"
    >
      configure ↗
    </a>
    {#if injectedCount > 0}
      <span class="ml-auto font-normal tabular-nums" data-testid="start-context-tokens">
        ~{preview?.totalTokens ?? 0} tok
      </span>
    {/if}
  </div>
  <div class="rounded-xl border border-border bg-card/40 p-2.5">
    {#if filesQuery.isPending}
      <p class="text-[11px] text-muted-foreground">scanning workspace…</p>
    {:else if filesQuery.isError}
      <p class="text-[11px] text-muted-foreground">files preview failed</p>
    {:else if preview?.mode === "none"}
      <p class="text-[11px] text-muted-foreground" data-testid="start-context-note">
        Off for this agent — its first message injects nothing from the workspace.
      </p>
    {:else if (preview?.files ?? []).length === 0}
      <p class="text-[11px] text-muted-foreground" data-testid="start-context-note">
        No candidate files (CLAUDE.md, README.md, package.json, …) found in the workspace.
      </p>
    {:else}
      <ContextFileList files={preview?.files ?? []} />
    {/if}
    <p class="mt-1.5 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
      Injected once, with the conversation's first message. Later messages can re-attach these from the
      composer's Context panel.
    </p>
  </div>
</div>
