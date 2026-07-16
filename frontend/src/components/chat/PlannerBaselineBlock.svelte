<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { plannerBaselineQueryOptions } from "@/api/plannerBaselineClient";
  import { compileChatToolOverrides } from "@/lib/chatToolOverrides";
  import { chatToolDraftRevision, getChatToolDraft } from "@/lib/chatToolDraft.svelte";

  // The planner's per-turn baseline — the system message EVERY planner call
  // resends: the agent's system prompt, the tools block (one line per enabled
  // tool, priced separately), and the fixed reply scaffolding. Tracks the
  // chat-tools draft so flipping a tool off shrinks the numbers live. Every
  // row expands to the exact text the planner receives.
  let { agentId }: { agentId: string } = $props();

  const baselineQuery = createQuery(() => {
    void $chatToolDraftRevision;
    return plannerBaselineQueryOptions(agentId, compileChatToolOverrides(getChatToolDraft()));
  });
  const baseline = $derived(baselineQuery.data);

  let expanded = $state<string | null>(null);

  function toggle(key: string): void {
    expanded = expanded === key ? null : key;
  }

  const rowClass =
    "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] hover:bg-secondary/45";
  const chevron = "h-2.5 w-2.5 shrink-0 text-muted-foreground transition-transform";
  const contentPre =
    "scrollbar-thin mx-1 mb-1 max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground";
</script>

<div data-testid="planner-baseline-section">
  <div class="flex items-center gap-1.5">
    <span
      class="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground"
      title="What the agent's setup itself costs: the system prompt, its tools, and the reply format — sent with every model request, on top of your message."
    >
      <svg class="h-3 w-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7Z" />
        <path d="M9 21h6" />
      </svg>
      Estimated token usage
    </span>
    {#if baseline}
      <span class="ml-auto text-[11px] tabular-nums text-muted-foreground" data-testid="planner-baseline-total">
        ~{baseline.totalTokens} tok
      </span>
    {/if}
  </div>
  <div class="mt-1 space-y-px">
    {#if baselineQuery.isPending}
      <p class="text-[11px] text-muted-foreground">estimating…</p>
    {:else if baselineQuery.isError}
      <p class="text-[11px] text-muted-foreground">baseline preview failed</p>
    {:else if baseline}
      <div>
        <button
          type="button"
          class={rowClass}
          data-testid="baseline-system-prompt-row"
          aria-expanded={expanded === "system"}
          onclick={() => toggle("system")}
          disabled={baseline.systemPrompt.content.length === 0}
        >
          <svg class="{chevron} {expanded === 'system' ? 'rotate-90' : ''} {baseline.systemPrompt.content ? '' : 'invisible'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span class="text-secondary-foreground">System prompt</span>
          {#if baseline.systemPrompt.content.length === 0}
            <span class="min-w-0 truncate text-muted-foreground">none for this agent</span>
          {/if}
          <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">~{baseline.systemPrompt.tokens} tok</span>
        </button>
        {#if expanded === "system" && baseline.systemPrompt.content}
          <pre class={contentPre}>{baseline.systemPrompt.content}</pre>
        {/if}
      </div>

      <div>
        <button
          type="button"
          class={rowClass}
          data-testid="baseline-tools-row"
          aria-expanded={expanded === "tools"}
          onclick={() => toggle("tools")}
        >
          <svg class="{chevron} {expanded === 'tools' ? 'rotate-90' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span class="text-secondary-foreground">Tools</span>
          <span class="min-w-0 truncate text-muted-foreground">
            {baseline.tools.perTool.length} enabled
          </span>
          <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">~{baseline.tools.tokens} tok</span>
        </button>
        {#if expanded === "tools"}
          <div class="mx-1 mb-1 space-y-px">
            {#each baseline.tools.perTool as tool (tool.name)}
              <div
                class="flex items-start gap-1.5 rounded px-1 py-0.5 text-[11px]"
                data-testid="baseline-tool-row"
                data-tool-name={tool.name}
              >
                <code class="shrink-0 text-secondary-foreground">{tool.name}</code>
                <span class="min-w-0 flex-1 truncate text-muted-foreground" title={tool.line}>{tool.line}</span>
                <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">~{tool.tokens} tok</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div>
        <button
          type="button"
          class={rowClass}
          data-testid="baseline-scaffolding-row"
          aria-expanded={expanded === "scaffolding"}
          onclick={() => toggle("scaffolding")}
        >
          <svg class="{chevron} {expanded === 'scaffolding' ? 'rotate-90' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span class="text-secondary-foreground">Reply scaffolding</span>
          <span class="min-w-0 truncate text-muted-foreground">fixed harness format</span>
          <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">~{baseline.scaffolding.tokens} tok</span>
        </button>
        {#if expanded === "scaffolding" && baseline.scaffolding.content}
          <pre class={contentPre}>{baseline.scaffolding.content}</pre>
        {/if}
      </div>
    {/if}
  </div>
</div>
