<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getConversationConfig, updateConversationConfig } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import { queryClient } from "@/lib/queryClient";
  import { notifyError, notifySuccess } from "@/utils/toast";
  import {
    DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG,
    type ConversationCategorizationConfig,
  } from "../../../../backend/src/contracts/conversation-config";
  import type { LlmSettings } from "@/types/llmSettings";
  import type { ModelGroup } from "./helpers";
  import GlobalModelSettingsCard from "./GlobalModelSettingsCard.svelte";
  import AsyncButton from "@/components/ui/AsyncButton.svelte";
  import { ghostBtn } from "./settingsClasses";

  let {
    settings,
    settingsLoading,
    modelGroups,
    onSettingsChange,
    onSaveProviders,
  }: {
    settings: LlmSettings | null;
    settingsLoading: boolean;
    modelGroups: ModelGroup[];
    onSettingsChange: (next: LlmSettings) => void;
    onSaveProviders: () => Promise<void>;
  } = $props();

  const configQuery = createQuery(() => ({
    queryKey: queryKeys.conversationConfig,
    queryFn: getConversationConfig,
    staleTime: 60_000,
  }));

  // Only the recent-conversations field is edited here; the rest of the
  // categorization config is preserved on save.
  let recentLimit = $state<number>(DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG.sidebarRecentLimit);
  let recentDirty = $state(false);

  $effect(() => {
    const data = configQuery.data;
    if (!data || recentDirty) return;
    recentLimit = data.sidebarRecentLimit;
  });

  async function saveRecentLimit(): Promise<void> {
    const base = configQuery.data ?? DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG;
    const next: ConversationCategorizationConfig = {
      ...base,
      sidebarRecentLimit: Math.min(200, Math.max(1, Math.trunc(recentLimit || 1))),
    };
    try {
      const saved = await updateConversationConfig(next);
      queryClient.setQueryData(queryKeys.conversationConfig, saved);
      recentLimit = saved.sidebarRecentLimit;
      recentDirty = false;
      notifySuccess("System settings saved");
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }
</script>

<div class="flex flex-col gap-3.5">
  {#if settingsLoading || !settings}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else}
    <div class="flex flex-col gap-3">
      <GlobalModelSettingsCard {settings} {modelGroups} {onSettingsChange} />
      <div class="flex items-center gap-2.5">
        <AsyncButton class="{ghostBtn} border-slate-300" onclick={onSaveProviders}>Save models</AsyncButton>
      </div>
    </div>

    <div class="rounded-lg border border-border bg-card">
      <div class="border-b border-border px-4 py-3">
        <div class="text-[14px] font-bold">Conversations</div>
        <div class="mt-0.5 text-[12px] text-muted-foreground">System-wide conversation behaviour.</div>
      </div>
      <div class="p-4">
        <label class="block">
          <span class="mb-1 block text-[13px] font-semibold text-foreground">Recent conversations to load</span>
          <span class="mb-2 block text-[12px] leading-snug text-muted-foreground">
            How many of the most-recent conversations the sidebar shows.
          </span>
          <input
            type="number"
            min="1"
            max="200"
            class="w-24 rounded-md border border-input bg-muted/50 px-2 py-1.5 text-sm"
            bind:value={recentLimit}
            oninput={() => (recentDirty = true)}
          />
        </label>
        <div class="mt-3 flex items-center gap-2.5">
          <AsyncButton class="{ghostBtn} border-slate-300" onclick={saveRecentLimit}>Save</AsyncButton>
        </div>
      </div>
    </div>
  {/if}
</div>
