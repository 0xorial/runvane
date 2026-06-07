<script lang="ts">
  import { isThoughtStreamEntry, type ChatEntry } from "@/protocol/chatEntry";
  import type { ChatSessionStore } from "@/lib/chatSessionStore";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import type { ObservableItem } from "@/utils/observableCollection";
  import RowIcon from "../RowIcon.svelte";
  import { entryIconName, entryPreview } from "./branchPreview";
  import Self from "./BranchNode.svelte";

  let {
    entry$,
    branchDepth,
    childRowsOf,
    sessionStore,
    activePathIds,
    pathTipId,
    switchingToEntryId,
    onSelectEntry,
  }: {
    entry$: ObservableItem<LinkedChatEntry>;
    branchDepth: number;
    childRowsOf: (parentId: string | null) => ObservableItem<LinkedChatEntry>[];
    sessionStore: ChatSessionStore;
    activePathIds: Set<string>;
    pathTipId: string | null;
    switchingToEntryId: string | null;
    onSelectEntry: (entryId: string) => void;
  } = $props();

  let entry = $state<ChatEntry | null>(null);
  let userExpanded = $state(false);

  $effect(() => {
    const row$ = entry$;
    entry = row$.get();
    return row$.subscribe(() => {
      entry = row$.get();
    });
  });

  const children = $derived(entry ? childRowsOf(entry.id) : []);
  const siblings = $derived(entry ? sessionStore.siblingsOf(entry.id) : []);
  const hasSiblings = $derived(siblings.length > 1);
  const nextBranchDepth = $derived(branchDepth + (hasSiblings ? 1 : 0));
  const isActive = $derived(entry ? activePathIds.has(entry.id) : false);
  const isLeaf = $derived(children.length === 0);
  const isSwitching = $derived(entry ? switchingToEntryId === entry.id : false);
  const isUserMessage = $derived(entry?.type === "user-message");
  const isBranchPoint = $derived(hasSiblings && !isActive && children.length > 0);
  const isCollapsedTurn = $derived(isUserMessage && !isActive && children.length > 0);
  const isCollapsible = $derived(isBranchPoint || isCollapsedTurn);
  const childrenVisible = $derived(!isCollapsible || userExpanded);
  const showToggle = $derived(isCollapsible);
  const iconName = $derived(entry ? entryIconName(entry) : "dot");
  const failedStream = $derived(
    entry != null && isThoughtStreamEntry(entry) && (entry.status === "failed" || entry.status === "cancelled"),
  );
</script>

{#if entry}
  {@const row = entry}
<div class={isUserMessage && branchDepth === 0 ? "mt-1.5 first:mt-0" : ""}>
  <div style={`padding-left: ${branchDepth * 10}px`}>
    <div
      class="flex min-w-0 items-start gap-0.5 py-0.5 text-left transition-colors {isActive
        ? 'text-foreground'
        : 'text-muted-foreground'} {isUserMessage ? 'font-medium' : ''} {!isActive
        ? 'hover:bg-secondary/40 hover:text-foreground'
        : ''} {isSwitching ? 'cursor-wait opacity-60' : ''}"
    >
      {#if showToggle}
        <button
          type="button"
          aria-label={userExpanded ? "Collapse branch" : "Expand branch"}
          class="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          onclick={(e) => {
            e.stopPropagation();
            userExpanded = !userExpanded;
          }}
        >
          <RowIcon name="chevron" class="h-3 w-3 transition-transform {userExpanded ? 'rotate-90' : ''}" />
        </button>
      {/if}
      <button
        type="button"
        disabled={isSwitching}
        class="flex min-w-0 flex-1 items-start gap-1.5 px-1 py-0.5 text-left"
        onclick={() => onSelectEntry(row.id)}
      >
        <span class="mt-0.5 shrink-0 {isActive ? 'text-primary' : 'text-muted-foreground'}">
          {#if failedStream}
            <RowIcon name="alert" class="h-3 w-3" />
          {:else}
            <RowIcon name={iconName} class="h-3 w-3" />
          {/if}
        </span>
        <span class="min-w-0 flex-1 truncate">{entryPreview(entry)}</span>
        {#if isLeaf && pathTipId === entry.id}
          <span class="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-primary">head</span>
        {/if}
      </button>
    </div>
  </div>
  {#if childrenVisible}
    {#each children as child$ (child$.id)}
      <Self
        entry$={child$}
        branchDepth={nextBranchDepth}
        {childRowsOf}
        {sessionStore}
        {activePathIds}
        {pathTipId}
        {switchingToEntryId}
        {onSelectEntry}
      />
    {/each}
  {/if}
</div>
{/if}
