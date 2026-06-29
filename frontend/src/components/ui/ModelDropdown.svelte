<script lang="ts">
  import { portal } from "@/lib/portal";
  import type { DropdownItem, ModelGroup } from "@/pages/settings/helpers";
  import type { Snippet } from "svelte";

  const POPUP_GAP = 6;
  const POPUP_MAX_HEIGHT = 300;

  type PopupPlacement = "below" | "above";

  type PopupLayout = {
    left: number;
    top: number;
    minWidth: number;
    maxHeight: number;
    placement: PopupPlacement;
  };

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

  function measurePopupLayout(anchor: HTMLElement): PopupLayout {
    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - POPUP_GAP;
    const spaceAbove = rect.top - POPUP_GAP;
    const placement: PopupPlacement = spaceBelow >= 180 || spaceBelow >= spaceAbove ? "below" : "above";
    const maxHeight = Math.min(POPUP_MAX_HEIGHT, Math.max(120, placement === "below" ? spaceBelow : spaceAbove));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 220));
    const top = placement === "below" ? rect.bottom + POPUP_GAP : rect.top - POPUP_GAP;
    return { left, top, minWidth: rect.width, maxHeight, placement };
  }

  let {
    value,
    onChange,
    groups,
    placeholder = "Select model",
    searchPlaceholder = "Search model",
    header,
    footer,
    disabled = false,
    buttonClass = "",
    initialOpen = false,
    onOpenChange,
  }: {
    value: string;
    onChange: (value: string, groupId?: string) => void;
    groups: ModelGroup[];
    placeholder?: string;
    searchPlaceholder?: string;
    /** Rendered at the top of the (portaled) panel, above the search input. */
    header?: Snippet;
    footer?: Snippet;
    disabled?: boolean;
    buttonClass?: string;
    initialOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = $props();

  let open = $state(initialOpen);
  let query = $state("");
  let searchInput = $state<HTMLInputElement | null>(null);
  let anchor = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLDivElement | null>(null);
  let popupLayout = $state<PopupLayout | null>(null);

  function syncPopupLayout(): void {
    if (!anchor) return;
    popupLayout = measurePopupLayout(anchor);
  }

  $effect(() => {
    if (disabled) open = false;
  });

  $effect(() => {
    onOpenChange?.(open);
  });

  $effect(() => {
    if (!open) {
      query = "";
      popupLayout = null;
      return;
    }
    syncPopupLayout();
    const id = requestAnimationFrame(() => searchInput?.focus());

    function onDocMouseDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchor?.contains(target) || panel?.contains(target)) return;
      open = false;
    }

    function onViewportChange(): void {
      syncPopupLayout();
    }

    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
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

<div class="relative">
  <button
    bind:this={anchor}
    type="button"
    class="flex min-h-[28px] w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-2.5 py-1 text-left text-sm text-foreground {disabled
      ? 'cursor-not-allowed opacity-55'
      : ''} {buttonClass}"
    {disabled}
    onclick={() => {
      open = !open;
      if (open) syncPopupLayout();
    }}
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
</div>

{#if open && popupLayout}
  <div
    use:portal
    bind:this={panel}
    class="fixed z-[1500] w-fit max-w-[min(90vw,calc(100vw-1rem))] overflow-hidden rounded-lg border border-border bg-popover shadow-xl {popupLayout.placement ===
      'above'
        ? '-translate-y-full'
        : ''}"
      style:left="{popupLayout.left}px"
      style:top="{popupLayout.top}px"
      style:min-width="{popupLayout.minWidth}px"
      role="listbox"
    >
      {#if header}
        <div class="border-b border-border p-2.5">
          {@render header()}
        </div>
      {/if}
      <div class="border-b border-border p-2.5">
        <input
          bind:this={searchInput}
          class="box-border w-full rounded-md border border-input bg-muted/40 py-1.5 pl-2 pr-8 text-sm"
          placeholder={searchPlaceholder}
          bind:value={query}
        />
      </div>
      <div class="overflow-auto px-2 pb-2 pt-1.5" style:max-height="{popupLayout.maxHeight}px">
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
