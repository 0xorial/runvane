<script lang="ts">
  import AsyncButton from "@/components/ui/AsyncButton.svelte";
  import Icon from "@/components/ui/Icon.svelte";
  import type { LlmSettings, ProviderRow } from "@/types/llmSettings";
  import { normalizeSearchToken } from "./helpers";
  import { providerGhostBtn } from "./settingsClasses";

  type Provider = ProviderRow & Record<string, unknown>;

  let {
    provider,
    settings,
    onSettingsChange,
    testConnection,
    modelFilter = "",
    onModelFilterChange,
    collapsed = true,
    onCollapsedChange,
  }: {
    provider: Provider;
    settings: LlmSettings;
    onSettingsChange: (next: LlmSettings) => void;
    testConnection: (p: Provider) => Promise<void>;
    modelFilter?: string;
    onModelFilterChange: (value: string) => void;
    collapsed?: boolean;
    onCollapsedChange: (collapsed: boolean) => void;
  } = $props();

  const providerKey = $derived(String(provider.id));
  const enabledSet = $derived.by(() => {
    const explicit = Array.isArray(provider.quick_access_models)
      ? provider.quick_access_models
      : Array.isArray(provider.enabled_models)
        ? provider.enabled_models
        : null;
    return new Set((explicit ?? provider.models ?? []) as string[]);
  });
  const allModels = $derived(provider.models_verified ? provider.models || [] : []);
  const sortedModels = $derived([...allModels].sort((a, b) => String(a).localeCompare(String(b))));
  const visibleModels = $derived.by(() => {
    const q = modelFilter.trim().toLowerCase();
    if (!q) return sortedModels;
    const nq = normalizeSearchToken(q);
    return sortedModels.filter((m) => {
      const raw = String(m).toLowerCase();
      return raw.includes(q) || normalizeSearchToken(raw).includes(nq);
    });
  });
  const settingsSpec = $derived(Array.isArray(provider.settings_spec) ? provider.settings_spec : []);

  function mutProviders(fn: (providers: Provider[], index: number) => void): void {
    const next = $state.snapshot(settings);
    const i = next.providers.findIndex((x) => x.id === provider.id);
    if (i < 0) return;
    fn(next.providers as Provider[], i);
    onSettingsChange(next);
  }
</script>

<div class="rounded-lg border border-border bg-card p-3.5">
  <div class="flex justify-between gap-3">
    <div>
      <div class="text-sm font-black">{String(provider.label ?? "")}</div>
      <div class="mt-0.5 text-xs text-muted-foreground">{String(provider.id)}</div>
    </div>
    <AsyncButton class={providerGhostBtn} onclick={() => testConnection(provider)}>Test connection</AsyncButton>
  </div>

  <div class="mt-5 border-t border-border pt-4">
    <div class="mt-3.5">
      <div
        class="mt-2.5 grid grid-cols-1 gap-2.5 md:grid-cols-2 [&_label]:flex [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-[13px] [&_label]:font-bold [&_label]:text-muted-foreground"
      >
        <label>
          Provider id
          <input
            class="rounded-[10px] border border-input bg-muted/50 px-2 py-1.5 text-sm"
            value={String(provider.id ?? "")}
            oninput={(e) => mutProviders((arr, i) => { arr[i].id = e.currentTarget.value; })}
          />
        </label>
        <label>
          Label
          <input
            class="rounded-[10px] border border-input bg-muted/50 px-2 py-1.5 text-sm"
            value={String(provider.label ?? "")}
            oninput={(e) => mutProviders((arr, i) => { arr[i].label = e.currentTarget.value; })}
          />
        </label>
        {#each settingsSpec as opt (opt.key)}
          {@const key = opt.key}
          {@const value = (provider.settings?.[key] as string | undefined) ?? (opt.placeholder != null ? String(opt.placeholder) : "")}
          <label>
            {opt.label || key}
            <input
              type="text"
              class="rounded-[10px] border border-input bg-muted/50 px-2 py-1.5 text-sm"
              {value}
              oninput={(e) =>
                mutProviders((arr, i) => {
                  const cur = arr[i];
                  cur.settings = { ...(cur.settings || {}), [key]: e.currentTarget.value };
                })}
            />
          </label>
        {/each}
      </div>
    </div>

    <div class="mb-3 mt-2.5 flex flex-wrap items-center justify-between gap-3">
      <button
        type="button"
        class="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-black text-muted-foreground"
        onclick={() => onCollapsedChange(!collapsed)}
      >
        {allModels.length} Models
        <Icon name="chevron-down" class="h-3.5 w-3.5 transition-transform duration-150 {collapsed ? '-rotate-90' : ''}" />
      </button>
      <input
        class="min-w-[180px] rounded-md border border-input bg-muted/40 px-2 py-1.5 text-sm"
        placeholder="Filter models"
        value={modelFilter}
        oninput={(e) => {
          onModelFilterChange(e.currentTarget.value);
          if (e.currentTarget.value.trim()) onCollapsedChange(false);
        }}
      />
    </div>

    {#if !collapsed}
      <div class="flex flex-col gap-0.5">
        {#each visibleModels as model (model)}
          {@const enabled = enabledSet.has(model)}
          <label
            class="flex cursor-pointer select-none items-center gap-3 border-b border-border py-2 pl-0.5 last:border-b-0 {!enabled
              ? 'opacity-55'
              : ''}"
          >
            <span class="font-mono text-[13px]">{model}</span>
            <input
              type="checkbox"
              class="ml-auto size-4 accent-primary"
              checked={enabled}
              onchange={(e) =>
                mutProviders((arr, i) => {
                  const current = arr[i];
                  const explicit = Array.isArray(current.quick_access_models)
                    ? current.quick_access_models
                    : Array.isArray(current.enabled_models)
                      ? current.enabled_models
                      : null;
                  const set = new Set(explicit ?? current.models ?? []);
                  if (e.currentTarget.checked) set.add(model);
                  else set.delete(model);
                  current.quick_access_models = Array.from(set);
                })}
            />
          </label>
        {/each}
      </div>
    {/if}
  </div>
</div>
