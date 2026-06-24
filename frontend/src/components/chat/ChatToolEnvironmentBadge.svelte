<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getToolEnvironments } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import {
    BUILTIN_TOOL_ENVIRONMENTS,
    normalizeEnvironmentId,
  } from "../../../../backend/src/contracts/tool-environment";
  import { toolEnvironmentDescription } from "@/lib/toolEnvironment";
  import ToolEnvironmentIcon from "./ToolEnvironmentIcon.svelte";

  // Read-only indicator of the environment bound to the current conversation.
  let { toolEnvironmentId }: { toolEnvironmentId: string | null } = $props();

  const envQuery = createQuery(() => ({ queryKey: queryKeys.toolEnvironments, queryFn: getToolEnvironments }));
  const environments = $derived(envQuery.data ?? BUILTIN_TOOL_ENVIRONMENTS);
  const resolvedId = $derived(normalizeEnvironmentId(toolEnvironmentId, environments.map((e) => e.id)));
  const env = $derived(environments.find((e) => e.id === resolvedId) ?? null);
</script>

{#if env}
  <span
    data-testid="chat-tool-env"
    data-env-id={env.id}
    title={toolEnvironmentDescription(env)}
    class="inline-flex max-w-[11rem] shrink-0 items-center gap-1 rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
  >
    <ToolEnvironmentIcon kind={env.kind} class="h-3 w-3 shrink-0" />
    <span class="truncate">{env.name}</span>
  </span>
{/if}
