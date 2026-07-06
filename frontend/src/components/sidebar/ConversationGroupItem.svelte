<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "@/components/ui/Icon.svelte";
  import { formatExactChatTime, formatRelativeChatTime } from "@/utils/formatRelativeChatTime";

  let {
    groupId,
    groupName,
    rowCount,
    shownCount,
    latestTimestampIso = "",
    collapsed,
    onToggle,
    children,
  }: {
    groupId: string;
    groupName: string;
    rowCount: number;
    /** Rows actually rendered for this group (≤ rowCount under the recent-N window). */
    shownCount: number;
    latestTimestampIso?: string;
    collapsed: boolean;
    onToggle: (groupId: string) => void;
    children: Snippet;
  } = $props();

  // Mirror the sidebar's shown/total counter; collapse to a single number when
  // the whole group is on screen.
  const countLabel = $derived(shownCount < rowCount ? `${shownCount}/${rowCount}` : String(rowCount));

  const stamp = $derived(formatRelativeChatTime(latestTimestampIso));
  const stampExact = $derived(formatExactChatTime(latestTimestampIso));
</script>

<div class="pt-1">
  <button
    type="button"
    data-testid={`sidebar-group-${groupId}`}
    data-sidebar-group-name={groupName}
    aria-label="{groupName} ({rowCount})"
    class="flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
    onclick={() => onToggle(groupId)}
  >
    <span class="min-w-0 flex flex-1 items-center gap-1.5 text-left">
      {#if collapsed}
        <Icon name="chevron-right" class="h-3.5 w-3.5 shrink-0" />
      {:else}
        <Icon name="chevron-down" class="h-3.5 w-3.5 shrink-0" />
      {/if}
      <span class="min-w-0">
        <span class="inline-flex min-w-0 items-center gap-1.5">
          <Icon name="folder" class="h-3.5 w-3.5 shrink-0" />
          <span class="block truncate font-semibold uppercase text-foreground/90">{groupName}</span>
        </span>
        {#if stamp}
          <span class="mt-0.5 block truncate text-[10px] text-muted-foreground" title={stampExact}>{stamp}</span>
        {/if}
      </span>
    </span>
    <span
      class="ml-2 shrink-0 self-start pt-0.5 text-[10px] text-muted-foreground"
      title="Showing {shownCount} of {rowCount} conversations"
    >{countLabel}</span>
  </button>
  {#if !collapsed}
    <!-- Indent + guide rail so member rows read as contained by the group,
         not as siblings of top-level conversations. -->
    <div class="ml-[13px] mt-0.5 flex flex-col gap-0.5 border-l border-border/70 pl-1.5">
      {@render children()}
    </div>
  {/if}
</div>
