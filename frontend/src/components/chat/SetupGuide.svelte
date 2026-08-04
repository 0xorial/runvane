<script lang="ts">
  import type { LlmProviderRow } from "../../../../backend/src/contracts/settings";
  import type { ToolSandbox } from "../../../../backend/src/contracts/tool-sandbox";
  import AsyncButton from "@/components/ui/AsyncButton.svelte";
  import Icon from "@/components/ui/Icon.svelte";
  import { createAgent, setDefaultAgent, testLlmProviderConnection } from "@/api/client";
  import { createAgentsQuery, createLlmProvidersQuery } from "@/hooks/queries/referenceData";
  import { queryKeys } from "@/hooks/queries/keys";
  import { queryClient } from "@/lib/queryClient";
  import { pathname as pathnameStore, replacePath } from "@/lib/router";
  import { providersReady, verifiedProviders } from "@/lib/setupState";
  import { maybeAutoStartTutorial, startTutorial } from "@/lib/tutorial/tutorialStore.svelte";
  import { notifyError } from "@/utils/toast";
  import AddSandboxDialog from "./AddSandboxDialog.svelte";

  let { dismissible }: { dismissible: boolean } = $props();

  const providersQuery = createLlmProvidersQuery();
  const agentsQuery = createAgentsQuery();
  const providers = $derived(providersQuery.data ?? []);
  const agents = $derived(agentsQuery.data ?? []);

  const providerDone = $derived(providersReady(providers));
  const agentDone = $derived(agents.length > 0);

  // One provider row expanded at a time; its settings are edited locally and
  // persisted by the backend on a successful connection test.
  let openProviderId = $state<string | null>(null);
  let fieldValues = $state<Record<string, string>>({});
  let testError = $state<string | null>(null);

  function toggleProvider(provider: LlmProviderRow): void {
    testError = null;
    if (openProviderId === provider.id) {
      openProviderId = null;
      return;
    }
    openProviderId = provider.id;
    const next: Record<string, string> = {};
    for (const spec of provider.settings_spec) {
      const existing = provider.settings?.[spec.key];
      next[spec.key] = existing != null ? String(existing) : "";
    }
    fieldValues = next;
  }

  async function testProvider(provider: LlmProviderRow): Promise<void> {
    testError = null;
    const settings: Record<string, unknown> = { ...(provider.settings ?? {}) };
    for (const spec of provider.settings_spec) settings[spec.key] = fieldValues[spec.key] ?? "";
    try {
      // A passing test persists the settings + model list server-side.
      const res = await testLlmProviderConnection({ provider_id: provider.id, settings });
      if (!res?.ok) throw new Error(res?.detail || "Connection test failed");
      await queryClient.invalidateQueries({ queryKey: queryKeys.llmProviders });
      openProviderId = null;
    } catch (e) {
      testError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  // Agent step: name + model, one create call. The picker lists verified
  // providers only, first model preselected.
  let agentName = $state("Assistant");
  let agentModel = $state("");
  const modelChoices = $derived(
    verifiedProviders(providers).flatMap((p) =>
      p.models.map((m) => ({ value: `${p.id} ${m}`, providerLabel: p.label || p.id, model: m })),
    ),
  );
  $effect(() => {
    if (!agentModel && modelChoices.length > 0) agentModel = modelChoices[0].value;
    if (agentModel && !modelChoices.some((c) => c.value === agentModel)) {
      agentModel = modelChoices[0]?.value ?? "";
    }
  });

  async function createFirstAgent(): Promise<void> {
    // The option value is "<providerId> <model>"; model names may themselves
    // contain spaces, so split at the first one only.
    const sep = agentModel.indexOf(" ");
    const providerId = sep > 0 ? agentModel.slice(0, sep) : "";
    const modelName = sep > 0 ? agentModel.slice(sep + 1) : "";
    if (!providerId || !modelName) {
      notifyError("Pick a model first — connect a provider if the list is empty");
      return;
    }
    const wasFirst = agents.length === 0;
    try {
      const created = await createAgent({
        name: agentName.trim() || "Assistant",
        default_llm_configuration: { provider_id: providerId, model_name: modelName },
      });
      if (wasFirst) await setDefaultAgent(created.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents });
      // Land on the agent cards with the new agent selected.
      const params = currentParams();
      params.set("agent", created.id);
      params.delete("setup");
      applyParams(params);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to create agent");
      throw e;
    }
  }

  let sandboxDialogOpen = $state(false);
  async function onSandboxCreated(env: ToolSandbox): Promise<void> {
    void env;
    await queryClient.invalidateQueries({ queryKey: queryKeys.toolSandboxes });
  }

  function currentParams(): URLSearchParams {
    const path = $pathnameStore;
    const q = path.indexOf("?");
    return new URLSearchParams(q >= 0 ? path.slice(q + 1) : "");
  }

  function applyParams(params: URLSearchParams): void {
    const path = $pathnameStore;
    const q = path.indexOf("?");
    const pathOnly = q >= 0 ? path.slice(0, q) : path;
    const next = params.toString();
    replacePath(next ? `${pathOnly}?${next}` : pathOnly);
  }

  function dismiss(): void {
    const params = currentParams();
    params.delete("setup");
    applyParams(params);
  }

  const stepBadge = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold";
  const inputClass = "w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-foreground";
  $effect(() => {
    // First open: the guide is forced by a broken chain (not ?setup=1 on a
    // healthy one) — walk the user through it unless they skipped or already
    // made progress. Once per session; the store owns the conditions.
    if (!dismissible) maybeAutoStartTutorial();
  });
</script>

<div class="flex h-full w-full items-start justify-center overflow-y-auto px-4 py-8" data-testid="setup-guide">
  <div class="w-full max-w-2xl">
    <div class="mb-1 text-base font-bold text-foreground">Set up runvane</div>
    <p class="mb-4 text-xs leading-relaxed text-muted-foreground">
      <strong>Providers</strong> supply models to everything; an <strong>agent</strong> is who you talk
      to; <strong>sandboxes</strong> are where its tools act; <strong>knowledge bases</strong> are what it
      can look up. Two steps make it usable:
    </p>

    <!-- Step 1: provider -->
    <section class="mb-3 rounded-xl border border-border bg-card/40 p-3" data-testid="setup-step-provider">
      <div class="flex items-center gap-2.5">
        {#if providerDone}
          <span class="{stepBadge} bg-primary text-primary-foreground" data-testid="setup-provider-done">
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
        {:else}
          <span class="{stepBadge} bg-secondary text-foreground">1</span>
        {/if}
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-foreground">Connect a model provider</div>
          <div class="text-[11px] text-muted-foreground">
            {providerDone
              ? `${verifiedProviders(providers).length} connected — agents, knowledge bases and presets pick models from here`
              : "Enter credentials and test the connection; a passing test saves it"}
          </div>
        </div>
      </div>
      <div class="mt-2.5 flex flex-col gap-1.5">
        {#each providers as provider (provider.id)}
          {@const verified = provider.models_verified && provider.models.length > 0}
          <div class="rounded-lg border border-border bg-card/60" data-testid="setup-provider-row" data-provider-id={provider.id}>
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left"
              onclick={() => toggleProvider(provider)}
            >
              <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{provider.label || provider.id}</span>
              {#if verified}
                <span class="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {provider.models.length} models
                </span>
              {:else}
                <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">not connected</span>
              {/if}
              <Icon
                name="chevron-down"
                class="h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 {openProviderId === provider.id ? '' : '-rotate-90'}"
              />
            </button>
            {#if openProviderId === provider.id}
              <div class="border-t border-border px-2.5 py-2.5">
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {#each provider.settings_spec as spec (spec.key)}
                    <label class="flex flex-col gap-1 text-xs">
                      <span class="font-semibold text-foreground">{spec.label || spec.key}</span>
                      <input
                        class={inputClass}
                        type={spec.type === "secret" ? "password" : "text"}
                        placeholder={spec.placeholder ?? ""}
                        data-testid="setup-provider-field-{spec.key}"
                        value={fieldValues[spec.key] ?? ""}
                        oninput={(e) => (fieldValues = { ...fieldValues, [spec.key]: e.currentTarget.value })}
                      />
                    </label>
                  {/each}
                </div>
                {#if testError}
                  <div class="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
                    {testError}
                  </div>
                {/if}
                <div class="mt-2.5">
                  <AsyncButton
                    class="rounded-lg border border-input bg-secondary/50 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary"
                    data-testid="setup-provider-test"
                    onclick={() => testProvider(provider)}
                  >
                    Test &amp; connect
                  </AsyncButton>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <!-- Step 2: agent -->
    <section class="mb-3 rounded-xl border border-border bg-card/40 p-3" data-testid="setup-step-agent">
      <div class="flex items-center gap-2.5">
        {#if agentDone}
          <span class="{stepBadge} bg-primary text-primary-foreground" data-testid="setup-agent-done">
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
        {:else}
          <span class="{stepBadge} bg-secondary text-foreground">2</span>
        {/if}
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-foreground">Create an agent</div>
          <div class="text-[11px] text-muted-foreground">
            {agentDone
              ? `${agents.length} configured — a name, a default model and tool permissions`
              : "A name and a default model are enough to start chatting"}
          </div>
        </div>
      </div>
      <div class="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label class="flex flex-col gap-1 text-xs">
          <span class="font-semibold text-foreground">Name</span>
          <input class={inputClass} data-testid="setup-agent-name" bind:value={agentName} placeholder="Assistant" />
        </label>
        <label class="flex flex-col gap-1 text-xs">
          <span class="font-semibold text-foreground">Model</span>
          <select class={inputClass} data-testid="setup-agent-model" bind:value={agentModel} disabled={modelChoices.length === 0}>
            {#if modelChoices.length === 0}
              <option value="">connect a provider first</option>
            {:else}
              {#each modelChoices as choice (choice.value)}
                <option value={choice.value}>{choice.providerLabel} · {choice.model}</option>
              {/each}
            {/if}
          </select>
        </label>
        <div class="flex items-end">
          <AsyncButton
            class="rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-55"
            data-testid="setup-agent-create"
            disabled={modelChoices.length === 0}
            onclick={createFirstAgent}
          >
            {agentDone ? "Add agent" : "Create agent"}
          </AsyncButton>
        </div>
      </div>
    </section>

    <!-- Later: sandboxes + knowledge bases -->
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <button
        type="button"
        class="group flex cursor-pointer items-start gap-2.5 rounded-xl border border-dashed border-border bg-transparent p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-card/40"
        data-testid="setup-add-sandbox"
        onclick={() => (sandboxDialogOpen = true)}
      >
        <span class="mt-0.5 text-muted-foreground"><Icon name="chevron-right" class="h-3.5 w-3.5" /></span>
        <span class="min-w-0">
          <span class="block text-[13px] font-medium text-foreground">Add a tool sandbox <span class="text-muted-foreground">(later is fine)</span></span>
          <span class="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
            Where an agent's tools run — this machine is built in; add ssh hosts to act elsewhere.
          </span>
        </span>
      </button>
      <a
        href="/settings/knowledge"
        class="group flex items-start gap-2.5 rounded-xl border border-dashed border-border bg-transparent p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-card/40"
        data-testid="setup-knowledge-link"
      >
        <span class="mt-0.5 text-muted-foreground"><Icon name="chevron-right" class="h-3.5 w-3.5" /></span>
        <span class="min-w-0">
          <span class="block text-[13px] font-medium text-foreground">Create a knowledge base <span class="text-muted-foreground">(later is fine)</span></span>
          <span class="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
            Indexed folders or sources agents can look up; needs an embedding model from a provider.
          </span>
        </span>
      </a>
    </div>

    <div class="mt-3">
      <button
        type="button"
        class="cursor-pointer border-0 bg-transparent p-0 text-xs text-muted-foreground underline hover:text-foreground"
        data-testid="setup-take-tour"
        onclick={() => startTutorial("connect-model")}
      >
        Prefer a guided tour? Walk the same setup on the real screens.
      </button>
    </div>

    {#if dismissible}
      <div class="mt-4">
        <button
          type="button"
          class="cursor-pointer border-0 bg-transparent p-0 text-xs text-muted-foreground underline hover:text-foreground"
          data-testid="setup-dismiss"
          onclick={dismiss}
        >
          Back to agents
        </button>
      </div>
    {/if}
  </div>
</div>

<AddSandboxDialog open={sandboxDialogOpen} onOpenChange={(o) => (sandboxDialogOpen = o)} onCreated={onSandboxCreated} />
