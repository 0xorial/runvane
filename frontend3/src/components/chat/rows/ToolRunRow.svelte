<script lang="ts">
  import type { ToolInvocationEntry } from "@/protocol/chatEntry";
  import ChatThreadIndent from "../ChatThreadIndent.svelte";
  import RowIcon from "../RowIcon.svelte";

  let { entry }: { entry: ToolInvocationEntry } = $props();

  let toggled = $state<boolean | null>(null);
  const expanded = $derived(toggled ?? entry.state === "requested");

  const toolName = $derived(entry.toolId || "tool");
  const paramsText = $derived(JSON.stringify(entry.parameters ?? {}, null, 2));
  const outputText = $derived(
    entry.result?.output != null ? JSON.stringify(entry.result.output, null, 2) : "",
  );
  const errorText = $derived(entry.result?.error ?? "");
  const statusLabel = $derived(
    entry.state === "requested"
      ? "Needs approval"
      : entry.state === "running"
        ? "Running"
        : entry.state === "done"
          ? "Done"
          : "Failed",
  );
</script>

<ChatThreadIndent>
  {#snippet children()}
    <div class="overflow-hidden rounded-md border bg-secondary/50">
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-secondary"
        aria-expanded={expanded}
        onclick={() => (toggled = !expanded)}
      >
        <RowIcon name="chevron" class="h-3 w-3 shrink-0 text-muted-foreground {expanded ? 'rotate-90' : ''}" />
        <RowIcon name="wrench" class="h-3 w-3 shrink-0 text-primary" />
        <span class="font-mono font-medium text-foreground">{toolName}</span>
        <span class="ml-auto text-[10px] font-medium text-muted-foreground">{statusLabel}</span>
      </button>
      {#if expanded}
        <div class="animate-slide-in space-y-2 border-t px-3 py-2">
          {#if errorText}
            <div class="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">{errorText}</div>
          {/if}
          <div>
            <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Arguments</span>
            <pre class="mt-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground">{paramsText}</pre>
          </div>
          {#if outputText}
            <div>
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Result</span>
              <pre class="scrollbar-thin mt-1 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground">{outputText}</pre>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/snippet}
</ChatThreadIndent>
