<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getToolSandboxes } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import {
    BUILTIN_TOOL_SANDBOXES,
    normalizeSandboxId,
  } from "../../../../backend/src/contracts/tool-sandbox";
  import { toolSandboxDescription } from "@/lib/toolSandbox";
  import ToolSandboxIcon from "./ToolSandboxIcon.svelte";

  // Read-only indicator of the sandbox bound to the current conversation.
  let { toolSandboxId }: { toolSandboxId: string | null } = $props();

  const envQuery = createQuery(() => ({ queryKey: queryKeys.toolSandboxes, queryFn: getToolSandboxes }));
  const sandboxes = $derived(envQuery.data ?? BUILTIN_TOOL_SANDBOXES);
  const resolvedId = $derived(normalizeSandboxId(toolSandboxId, sandboxes.map((e) => e.id)));
  const env = $derived(sandboxes.find((e) => e.id === resolvedId) ?? null);
</script>

{#if env}
  <span
    data-testid="chat-tool-env"
    data-env-id={env.id}
    title={toolSandboxDescription(env)}
    class="inline-flex min-w-12 max-w-[11rem] items-center gap-1 rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
  >
    <ToolSandboxIcon kind={env.kind} class="h-3 w-3 shrink-0" />
    <span class="truncate">{env.name}</span>
  </span>
{/if}
