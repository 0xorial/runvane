<script lang="ts">
  import type { DropdownItem, ModelGroup } from "@/pages/settings/helpers";
  import type { Snippet } from "svelte";

  function normalizeToken(value: unknown): string {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function itemValue(item: DropdownItem): string {
    return typeof item === "string" ? item : item.value;
  }

  function itemLabel(item: DropdownItem): string {
    return typeof item === "string" ? item : item.label;
  }

  function itemClassName(item: DropdownItem): string | undefined {
    return typeof item === "string" ? undefined : item.className;
  }

  let {
    value,
    onChange,
    groups,
    placeholder = "Select model",
    searchPlaceholder = "Search model",
    footer,
    disabled = false,
    buttonClass = "",
  }: {
    value: string;
    onChange: (value: string, groupId?: string) => void;
    groups: ModelGroup[];
    placeholder?: string;
    searchPlaceholder?: string;
    footer?: Snippet;
    disabled?: boolean;
    buttonClass?: string;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let searchInput = $state<HTMLInputElement | null>(null);
  let root = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (disabled) open = false;
  });

  $effect(() => {
    if (!open) {
      query = "";
      return;
    }
    const id = requestAnimationFrame(() => searchInput?.focus());
    function onDocMouseDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node) || !root?.contains(target)) open = false;
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDocMouseDown);
    };
  });

  const normalizedQuery = $derived(normalizeToken(query));

  const filteredGroups = $derived.by(() => {
    const qRaw = query.trim().toLowerCase();
    if (!qRaw) return groups;
    return groups
      .map((g) => ({
        ...g,
        models: (g.models || []).filter((m) => {
          const raw = itemLabel(m).toLowerCase();
          return raw.includes(qRaw) || normalizeToken(raw).includes(normalizedQuery);
        }),
      }))
      .filter((g) => g.models.length > 0);
  });

  const selectedLabel = $derived.by(() => {
    for (const g of groups) {
      for (const m of g.models || []) {
        if (itemValue(m) === value) return itemLabel(m);
      }
    }
    return value || "";
  });
</script>

<div class="relative" bind:this={root}>
  <button
    type="button"
    class="flex min-h-[28px] w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-2.5 py-1 text-left text-sm text-foreground {disabled
      ? 'cursor-not-allowed opacity-55'
      : ''} {buttonClass}"
    {disabled}
    onclick={() => (open = !open)}
  >
    <span class="min-w-0 flex-1 truncate whitespace-nowrap {!selectedLabel ? 'text-muted-foreground' : ''}">
      {selectedLabel || placeholder}
    </span>
    <span class="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground transition-transform duration-150 {open ? 'rotate-180' : ''}" aria-hidden="true">
      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  </button>
  {#if open}
    <div class="absolute left-0 top-full z-[1400] mt-1.5 w-fit max-w-[90vw] overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
      <div class="border-b border-border p-2.5">
        <input
          bind:this={searchInput}
          class="box-border w-full rounded-md border border-input bg-muted/40 py-1.5 pl-2 pr-8 text-sm"
          placeholder={searchPlaceholder}
          bind:value={query}
        />
      </div>
      <div class="max-h-[300px] overflow-auto px-2 pb-2 pt-1.5">
        {#if filteredGroups.length === 0}
          <div class="px-1.5 py-2 text-[13px] text-muted-foreground">No results</div>
        {/if}
        {#each filteredGroups as g (g.id)}
          <div class="mt-1.5 first:mt-0">
            {#if g.label}
              <div class="px-1.5 py-1 text-xs font-bold text-muted-foreground">{g.label}</div>
            {/if}
            {#each g.models as m (`${g.id}:${itemValue(m)}`)}
              {@const v = itemValue(m)}
              {@const l = itemLabel(m)}
              {@const extra = itemClassName(m)}
              <button
                type="button"
                class="block w-full cursor-pointer whitespace-nowrap rounded-md border-0 bg-transparent px-2.5 py-2 text-left font-mono text-sm text-foreground hover:bg-primary/10 {v === value ? 'bg-primary/15' : ''} {extra ?? ''}"
                onclick={() => {
                  onChange(v, g.id);
                  open = false;
                }}
              >
                {l}
              </button>
            {/each}
          </div>
        {/each}
      </div>
      {#if footer}
        <div class="border-t border-border px-3 py-2 text-[13px] [&_a]:font-semibold [&_a]:text-primary [&_a]:no-underline hover:[&_a]:underline">
          {@render footer()}
        </div>
      {/if}
    </div>
  {/if}
</div>
