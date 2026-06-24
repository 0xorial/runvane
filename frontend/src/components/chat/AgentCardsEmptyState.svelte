<script lang="ts">
  import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
  import type { ToolEnvironment } from "../../../../backend/src/contracts/tool-environment";
  import AgentIcon from "@/components/ui/AgentIcon.svelte";
  import { createAgentsQuery } from "@/hooks/queries/referenceData";
  import { getAgentColor } from "@/pages/settings/agentColors";
  import { getAgentLlm } from "@/pages/settings/agentLlm";
  import { sortAgents } from "@/pages/settings/helpers";
  import { replacePath, pathname as pathnameStore, toolEnvironmentIdFromSearch } from "@/lib/router";
  import { createQuery } from "@tanstack/svelte-query";
  import { getToolEnvironments } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";

  let { selectedAgentId }: { selectedAgentId: string } = $props();

  const agentsQuery = createAgentsQuery();
  const agents = $derived(sortAgents(agentsQuery.data ?? []));

  // Tool environment for the new conversation, persisted in the URL (?env=) so
  // ChatComposer reads it when it creates the conversation.
  const envQuery = createQuery(() => ({ queryKey: queryKeys.toolEnvironments, queryFn: getToolEnvironments }));
  const environments = $derived(envQuery.data ?? []);
  let selectedEnvId = $state("local");
  $effect(() => {
    const path = $pathnameStore;
    const q = path.indexOf("?");
    const fromUrl = toolEnvironmentIdFromSearch(q >= 0 ? path.slice(q + 1) : "") || "local";
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

  function envDescription(env: ToolEnvironment): string {
    if (env.kind === "none") return "No sandbox — runtime tools are disabled for this chat.";
    if (env.kind === "ssh" && env.ssh) {
      const target = `${env.ssh.user ? `${env.ssh.user}@` : ""}${env.ssh.host}${env.ssh.port ? `:${env.ssh.port}` : ""}`;
      return `Tools run over ssh on ${target}.`;
    }
    return "Tools run on the same host as the agentic framework.";
  }

  function enabledToolIds(agent: AgentListItemResponse): string[] {
    const tools = agent.default_llm_configuration?.tools;
    if (!tools) return [];
    return Object.entries(tools)
      .filter(([, cfg]) => cfg?.enabled !== false)
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

{#if agents.length > 0}
  <div class="flex h-full w-full items-center justify-center px-4 py-8">
    <div class="w-full max-w-3xl">
      {#snippet envIcon(kind: string)}
        <svg class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
          {#if kind === "none"}
            <circle cx="12" cy="12" r="9" />
            <path d="m5.7 5.7 12.6 12.6" />
          {:else if kind === "ssh"}
            <rect x="3" y="4" width="18" height="7" rx="2" />
            <rect x="3" y="13" width="18" height="7" rx="2" />
            <path d="M7 7.5h.01M7 16.5h.01" />
          {:else}
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
          {/if}
        </svg>
      {/snippet}
      {#if environments.length > 1}
        <div class="mb-4">
          <div class="mb-1.5 text-xs font-medium text-muted-foreground">Tool environment</div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {#each environments as env (env.id)}
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
                class="group flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card/40 p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-card {selected
                  ? 'border-primary/70 bg-primary/5'
                  : ''}"
              >
                <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/60 text-foreground">
                  {@render envIcon(env.kind)}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-foreground">{env.name}</span>
                  <span class="mt-0.5 block break-words text-[11px] leading-snug text-muted-foreground">{envDescription(env)}</span>
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
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
    </div>
  </div>
{/if}
