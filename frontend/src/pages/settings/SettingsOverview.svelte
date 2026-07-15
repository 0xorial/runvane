<script lang="ts">
  import { onMount } from "svelte";
  import { createQuery } from "@tanstack/svelte-query";
  import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
  import type { LlmSettings } from "@/types/llmSettings";
  import { getToolSandboxes } from "@/api/client";
  import { getKnowledgeStorages } from "@/api/knowledgeClient";
  import { queryKeys } from "@/hooks/queries/keys";
  import { setupChainComplete, verifiedProviders } from "@/lib/setupState";
  import type { SettingsSection } from "./helpers";

  let {
    settings,
    agents,
    onNavigate,
  }: {
    settings: LlmSettings | null;
    agents: AgentListItemResponse[];
    onNavigate: (section: SettingsSection) => void;
  } = $props();

  const sandboxesQuery = createQuery(() => ({ queryKey: queryKeys.toolSandboxes, queryFn: getToolSandboxes }));
  let storageCount = $state<number | null>(null);
  onMount(async () => {
    try {
      storageCount = (await getKnowledgeStorages()).length;
    } catch {
      storageCount = null;
    }
  });

  const providers = $derived(settings?.providers ?? []);
  const verifiedCount = $derived(verifiedProviders(providers).length);
  const chainComplete = $derived(setupChainComplete(providers, agents.length));

  type ConceptCard = {
    section: SettingsSection;
    title: string;
    count: string;
    role: string;
  };
  const cards = $derived<ConceptCard[]>([
    {
      section: "model-providers",
      title: "Providers",
      count: `${verifiedCount} of ${providers.length} connected`,
      role: "Model sources — everything below picks its models here.",
    },
    {
      section: "agents",
      title: "Agents",
      count: `${agents.length} configured`,
      role: "Who you talk to: prompt + default model + tool permissions.",
    },
    {
      section: "tool-sandboxes",
      title: "Sandboxes",
      count: `${sandboxesQuery.data?.length ?? "…"} available`,
      role: "Where an agent's tools act: this machine, none, or ssh hosts.",
    },
    {
      section: "knowledge",
      title: "Knowledge bases",
      count: storageCount == null ? "—" : `${storageCount} indexed`,
      role: "Context agents can look up and inject; embeds via a provider model.",
    },
  ]);
</script>

<div class="flex flex-col gap-3" data-testid="settings-overview">
  {#if !chainComplete}
    <div
      class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5"
      data-testid="overview-setup-banner"
    >
      <div class="text-[13px] text-foreground">
        <strong>Not ready to chat yet</strong> — runvane needs a connected provider and one agent.
      </div>
      <a href="/chat/new?setup=1" class="text-[13px] font-semibold text-primary underline-offset-4 hover:underline">
        Open the setup guide →
      </a>
    </div>
  {/if}

  <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
    {#each cards as card, i (card.section)}
      <button
        type="button"
        class="group relative flex cursor-pointer flex-col gap-1 rounded-xl border border-border bg-card/40 p-3.5 text-left transition-colors hover:border-primary/60 hover:bg-card"
        data-testid="overview-card-{card.section}"
        onclick={() => onNavigate(card.section)}
      >
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-sm font-bold text-foreground">{i + 1}. {card.title}</span>
          <span class="text-[11px] font-medium text-muted-foreground">{card.count}</span>
        </div>
        <span class="text-xs leading-snug text-muted-foreground">{card.role}</span>
      </button>
    {/each}
  </div>

  <p class="px-1 text-xs leading-relaxed text-muted-foreground">
    <strong>Providers</strong> feed models to everything. An <strong>agent</strong> answers your
    chats with its default model, and its tools run in the conversation's
    <strong>sandbox</strong>; it can inject context from
    <strong>knowledge bases</strong>, which embed content through a provider model too. Model
    <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-primary underline-offset-4 hover:underline" onclick={() => onNavigate("model-presets")}>presets</button>,
    <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-primary underline-offset-4 hover:underline" onclick={() => onNavigate("model-pricing")}>pricing</button>
    and
    <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-primary underline-offset-4 hover:underline" onclick={() => onNavigate("system")}>system defaults</button>
    refine how models are called, billed and reported.
  </p>
</div>
