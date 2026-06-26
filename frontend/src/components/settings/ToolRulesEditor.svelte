<script lang="ts">
  import CodeEditor from "@/components/ui/CodeEditor.svelte";
  import ZodJsonEditor from "@/components/ui/ZodJsonEditor.svelte";
  import { DEFAULT_GUARDRAIL_PROMPT } from "../../../../backend/src/contracts/guardrail";
  import type { ToolConfig } from "@/pages/settings/agentTools";

  let {
    toolName,
    config,
    rulesSchema,
    guardrailLlmConfigured,
    globalGuardrailPrompt = "",
    readOnly = false,
    rulesEditorHeight = 180,
    onPatch,
  }: {
    toolName: string;
    config: ToolConfig;
    rulesSchema?: import("zod").ZodType;
    guardrailLlmConfigured: boolean;
    globalGuardrailPrompt?: string;
    readOnly?: boolean;
    rulesEditorHeight?: number;
    onPatch: (patch: {
      guardrail?: boolean;
      guardrail_system_prompt?: string;
      config?: Record<string, unknown>;
    }) => void;
  } = $props();

  let rulesDraft = $state("");
  let rulesError = $state("");

  $effect(() => {
    rulesDraft = JSON.stringify(config.config, null, 2);
    rulesError = "";
  });

  function onRulesChange(raw: string): void {
    rulesDraft = raw;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        rulesError = "Config must be a JSON object.";
        return;
      }
      rulesError = "";
      onPatch({ config: parsed as Record<string, unknown> });
    } catch {
      rulesError = "Invalid JSON.";
    }
  }
</script>

<div class="space-y-3">
  <div class="text-xs font-semibold text-foreground"><code>{toolName}</code> rules</div>
  {#if rulesSchema}
    <ZodJsonEditor
      schema={rulesSchema}
      value={rulesDraft}
      onchange={onRulesChange}
      height={rulesEditorHeight}
      resizable
      {readOnly}
    />
  {:else}
    <CodeEditor
      value={rulesDraft}
      onchange={onRulesChange}
      language="json"
      height={rulesEditorHeight}
      resizable
      {readOnly}
    />
    {#if rulesError}
      <div class="text-xs text-destructive" role="alert">{rulesError}</div>
    {/if}
  {/if}
  <label class="inline-flex items-center gap-2 text-xs text-muted-foreground">
    <input
      type="checkbox"
      checked={config.guardrail}
      disabled={readOnly || !guardrailLlmConfigured}
      onchange={(e) => onPatch({ guardrail: e.currentTarget.checked })}
    />
    Guardrail
  </label>
  {#if config.guardrail && guardrailLlmConfigured}
    <label class="flex flex-col gap-1 text-xs">
      <span class="font-semibold text-foreground">Guardrail prompt override</span>
      <textarea
        class="min-h-[72px] w-full resize-y rounded-lg border border-input bg-background p-2 text-xs"
        value={config.guardrail_system_prompt}
        disabled={readOnly}
        oninput={(e) => onPatch({ guardrail_system_prompt: e.currentTarget.value })}
        placeholder={globalGuardrailPrompt || DEFAULT_GUARDRAIL_PROMPT}
        rows={3}
        spellcheck={false}
      ></textarea>
    </label>
  {/if}
</div>
