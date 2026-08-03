<script lang="ts">
  import {
    classifyRules,
    deriveSignature,
    type RulesField,
  } from "@/pages/settings/toolFacets";
  import { TOOL_POLICIES, type ToolPolicy } from "@/pages/settings/agentTools";

  let {
    toolName,
    paramsSchema,
    effectiveRules,
    policy,
  }: {
    toolName: string;
    paramsSchema: unknown;
    effectiveRules: Record<string, unknown>;
    policy: ToolPolicy;
  } = $props();

  const signature = $derived(deriveSignature(paramsSchema));
  const rules = $derived(classifyRules(effectiveRules));
  const policyHint = $derived(TOOL_POLICIES.find((p) => p.value === policy)?.hint ?? "");

  function valueClass(field: RulesField): string {
    return field.attention ? "text-amber-600" : "text-foreground";
  }
</script>

<div class="space-y-2.5 text-xs" data-testid="tool-clear-view">
  {#if signature.operations.length > 0}
    <div>
      <div class="mb-1 text-[11px] font-medium text-muted-foreground">Operations</div>
      <div class="flex flex-wrap gap-1" data-testid="clear-view-operations">
        {#each signature.operations as op (op)}
          <code class="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-foreground">{op}</code>
        {/each}
      </div>
    </div>
  {/if}

  {#if signature.params.length > 0}
    <div>
      <div class="mb-1 text-[11px] font-medium text-muted-foreground">Parameters</div>
      <div class="space-y-0.5" data-testid="clear-view-params">
        {#each signature.params as p (p.name)}
          <div class="grid grid-cols-[10px_120px_44px_1fr] items-baseline gap-2 leading-tight">
            <span class="text-foreground" title={p.required ? "required" : ""}>{p.required ? "•" : ""}</span>
            <code class="font-mono text-[12px] text-foreground">{p.name}</code>
            <span class="font-mono text-[11px] text-muted-foreground">{p.type}</span>
            <span class="text-muted-foreground">{p.description}</span>
          </div>
        {/each}
      </div>
      <div class="mt-1 text-[10px] text-muted-foreground"><span class="text-foreground">•</span> required · others optional</div>
    </div>
  {/if}

  {#if rules.safety.length > 0}
    <div>
      <div class="mb-1 text-[11px] font-medium text-muted-foreground">Safety</div>
      <div class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5" data-testid="clear-view-safety">
        {#each rules.safety as f (f.key)}
          <code class="font-mono text-[11px] text-muted-foreground">{f.key}</code>
          <span class="font-mono text-[11px] {valueClass(f)}">{f.value}</span>
        {/each}
      </div>
    </div>
  {/if}

  {#if rules.limits.length > 0}
    <div>
      <div class="mb-1 text-[11px] font-medium text-muted-foreground">Limits</div>
      <div class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5" data-testid="clear-view-limits">
        {#each rules.limits as f (f.key)}
          <code class="font-mono text-[11px] text-muted-foreground">{f.key}</code>
          <span class="font-mono text-[11px] text-foreground">{f.value}</span>
        {/each}
      </div>
    </div>
  {/if}

  <div>
    <div class="text-[11px] font-medium text-muted-foreground">Policy · {policy}</div>
    {#if policyHint}
      <div class="text-[11px] text-muted-foreground">{policyHint}</div>
    {/if}
  </div>

  <details class="mt-1">
    <summary class="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Raw schema</summary>
    <pre class="mt-1 max-h-64 overflow-auto rounded border border-border bg-muted/50 p-2 font-mono text-[10px] leading-snug text-muted-foreground">{JSON.stringify(paramsSchema, null, 2)}</pre>
  </details>
</div>
