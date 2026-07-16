<script lang="ts">
  import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
  import type { ToolSandbox } from "../../../../backend/src/contracts/tool-sandbox";
  import AgentIcon from "@/components/ui/AgentIcon.svelte";
  import { createAgentsQuery } from "@/hooks/queries/referenceData";
  import { getAgentColor } from "@/pages/settings/agentColors";
  import { getAgentLlm } from "@/pages/settings/agentLlm";
  import { sortAgents } from "@/pages/settings/helpers";
  import { replacePath, pathname as pathnameStore, toolSandboxIdFromSearch } from "@/lib/router";
  import { createQuery } from "@tanstack/svelte-query";
  import { getToolSandboxes } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import { queryClient } from "@/lib/queryClient";
  import AddSandboxDialog from "./AddSandboxDialog.svelte";
  import SetupGuide from "./SetupGuide.svelte";
  import StartContextSection from "./StartContextSection.svelte";
  import ToolSandboxIcon from "./ToolSandboxIcon.svelte";
  import HarnessToolsHint from "./HarnessToolsHint.svelte";
  import { toolSandboxDescription } from "@/lib/toolSandbox";
  import { createLlmProvidersQuery } from "@/hooks/queries/referenceData";
  import { providersReady } from "@/lib/setupState";

  let { selectedAgentId }: { selectedAgentId: string } = $props();

  const agentsQuery = createAgentsQuery();
  const agents = $derived(sortAgents(agentsQuery.data ?? []));

  // The setup guide replaces the cards whenever the core chain is broken (no
  // verified provider or no agents) and can be revisited via ?setup=1. Both
  // queries must have resolved before deciding, or the guide would flash on
  // every load.
  const providersQuery = createLlmProvidersQuery();
  const setupForced = $derived.by(() => {
    const path = $pathnameStore;
    const q = path.indexOf("?");
    return new URLSearchParams(q >= 0 ? path.slice(q + 1) : "").get("setup") === "1";
  });
  const setupDataLoaded = $derived(agentsQuery.data !== undefined && providersQuery.data !== undefined);
  const chainBroken = $derived(setupDataLoaded && (agents.length === 0 || !providersReady(providersQuery.data)));
  const showSetupGuide = $derived(setupForced || chainBroken);

  // Tool sandbox for the new conversation, persisted in the URL (?env=) so
  // ChatComposer reads it when it creates the conversation.
  const envQuery = createQuery(() => ({ queryKey: queryKeys.toolSandboxes, queryFn: getToolSandboxes }));
  const sandboxes = $derived(envQuery.data ?? []);
  let selectedEnvId = $state("local");
  $effect(() => {
    const path = $pathnameStore;
    const q = path.indexOf("?");
    const fromUrl = toolSandboxIdFromSearch(q >= 0 ? path.slice(q + 1) : "") || "local";
    if (fromUrl !== selectedEnvId) selectedEnvId = fromUrl;
  });

  function selectEnv(envId: string): void {
    const path = $pathnameStore;
    const q = path.indexOf("?");
    const pathOnly = q >= 0 ? path.slice(0, q) : path;
    const params = new URLSearchParams(q >= 0 ? path.slice(q + 1) : "");
    if (envId && envId !== "local") params.set("env", envId);
    else params.delete("env");
    const next = params.toString();
    replacePath(next ? `${pathOnly}?${next}` : pathOnly);
  }

  let addOpen = $state(false);
  async function onEnvCreated(env: ToolSandbox): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: queryKeys.toolSandboxes });
    selectEnv(env.id);
  }

  function enabledToolIds(agent: AgentListItemResponse): string[] {
    const tools = agent.default_llm_configuration?.tools;
    if (!tools) return [];
    return Object.entries(tools)
      .filter(([, cfg]) => cfg?.policy != null && cfg.policy !== "off")
      .map(([id]) => id)
      .sort((a, b) => a.localeCompare(b));
  }

  function selectAgent(agentId: string): void {
    const path = $pathnameStore;
    const q = path.indexOf("?");
    const pathOnly = q >= 0 ? path.slice(0, q) : path;
    const search = q >= 0 ? path.slice(q + 1) : "";
    const params = new URLSearchParams(search);
    params.set("agent", agentId);
    const next = params.toString();
    replacePath(next ? `${pathOnly}?${next}` : pathOnly);
  }
</script>

{#if showSetupGuide}
  <SetupGuide dismissible={setupForced && !chainBroken} />
{:else if agents.length > 0}
  <div class="flex h-full w-full items-center justify-center px-4 py-8">
    <div class="w-full max-w-3xl">
      {#if sandboxes.length > 1}
        <div class="mb-4">
          <div class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            Tool sandbox
            <HarnessToolsHint side="bottom" />
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {#each sandboxes as env (env.id)}
              {@const selected = selectedEnvId === env.id}
              <div
                role="button"
                tabindex="0"
                data-testid="tool-env-card"
                data-env-id={env.id}
                aria-pressed={selected}
                onclick={() => selectEnv(env.id)}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectEnv(env.id);
                  }
                }}
                class="group relative flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card/40 p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-card {selected
                  ? 'border-primary/70 bg-primary/5'
                  : ''}"
              >
                <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/60 text-foreground">
                  <ToolSandboxIcon kind={env.kind} />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate pr-5 text-sm font-medium text-foreground">{env.name}</span>
                  <span class="mt-0.5 block break-words text-[11px] leading-snug text-muted-foreground">{toolSandboxDescription(env)}</span>
                </span>
                {#if !env.builtin}
                  <a
                    href="/settings/tool-sandboxes"
                    title="Sandbox details"
                    onclick={(e) => e.stopPropagation()}
                    class="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-secondary/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85">
                      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span class="sr-only">Sandbox details</span>
                  </a>
                {/if}
              </div>
            {/each}
            <button
              type="button"
              data-testid="tool-env-add"
              onclick={() => (addOpen = true)}
              class="group flex cursor-pointer items-center gap-2.5 rounded-xl border border-dashed border-border bg-transparent p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-card/40"
            >
              <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/40 text-muted-foreground">
                <svg class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </span>
              <span class="text-sm font-medium text-muted-foreground">Add sandbox</span>
            </button>
          </div>
        </div>
      {/if}
      <div class="mb-1.5 text-xs font-medium text-muted-foreground">Agent</div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {#each agents as agent (agent.id)}
        {@const llm = getAgentLlm(agent)}
        {@const model = llm.model.trim()}
        {@const selected = selectedAgentId === agent.id}
        {@const color = getAgentColor(agent.color)}
        <div
          role="button"
          tabindex="0"
          onclick={() => selectAgent(agent.id)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              selectAgent(agent.id);
            }
          }}
          class="group relative flex min-h-[88px] cursor-pointer items-start gap-3 rounded-xl border border-border bg-card/40 p-3 text-left transition-colors hover:border-primary/60 hover:bg-card {selected
            ? 'border-primary/70 bg-primary/5'
            : ''}"
        >
          <span class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg {color.wrap}">
            <AgentIcon iconId={agent.icon} class="h-4.5 w-4.5" strokeWidth={1.85} />
            {#if agent.is_default}
              <span
                class="absolute -bottom-1 -right-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-card bg-primary text-primary-foreground"
                title="Default agent"
              >
                <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
            {/if}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate pr-6 text-sm font-medium text-foreground">
              {agent.name.trim() || "Untitled agent"}
            </span>
            {#if model}
              <span class="mt-0.5 block break-all font-mono text-[11px] leading-snug text-muted-foreground">{model}</span>
            {/if}
            <span class="mt-1 block break-words text-[11px] leading-snug text-muted-foreground">
              {#if enabledToolIds(agent).length === 0}
                <span class="italic">no tools access</span>
              {:else}
                {enabledToolIds(agent).join(", ")}
              {/if}
            </span>
          </span>
          <a
            href="/settings/agents?agent={encodeURIComponent(agent.id)}"
            title="Open agent settings"
            onclick={(e) => e.stopPropagation()}
            class="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-secondary/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span class="sr-only">Open agent settings</span>
          </a>
        </div>
      {/each}
      </div>
      {#if selectedAgentId}
        <StartContextSection agentId={selectedAgentId} toolSandboxId={selectedEnvId} />
      {/if}
    </div>
  </div>
  <AddSandboxDialog open={addOpen} onOpenChange={(o) => (addOpen = o)} onCreated={onEnvCreated} />
{/if}
