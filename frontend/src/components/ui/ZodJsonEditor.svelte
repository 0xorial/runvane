<script lang="ts">
  import { z } from "zod";
  import CodeEditor from "./CodeEditor.svelte";
  import Icon from "./Icon.svelte";
  import ZodJsonSchemaView from "./ZodJsonSchemaView.svelte";

  type JsonSchemaNode = {
    type?: string | string[];
    properties?: Record<string, { default?: unknown }>;
  };

  let {
    schema,
    value,
    onchange,
    onValidValue,
    onValidityChange,
    height = 220,
    readOnly = false,
    onSubmitShortcut,
    onEscapeShortcut,
    resizable = false,
    minHeight = 120,
    maxHeight = 800,
  }: {
    schema: z.ZodType;
    value: string;
    onchange: (text: string) => void;
    onValidValue?: (value: unknown) => void;
    onValidityChange?: (valid: boolean) => void;
    height?: number;
    readOnly?: boolean;
    onSubmitShortcut?: () => void;
    onEscapeShortcut?: () => void;
    resizable?: boolean;
    minHeight?: number;
    maxHeight?: number;
  } = $props();

  const jsonSchema = $derived.by((): JsonSchemaNode | undefined => {
    try {
      return z.toJSONSchema(schema) as JsonSchemaNode;
    } catch {
      return undefined;
    }
  });

  const schemaText = $derived(jsonSchema ? JSON.stringify(jsonSchema, null, 2) : undefined);

  const validation = $derived.by(() => {
    const text = value.trim();
    if (!text) return { kind: "syntax" as const, message: "Empty — expected a JSON object." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { kind: "syntax" as const, message: e instanceof Error ? e.message : "Invalid JSON." };
    }
    const result = schema.safeParse(parsed);
    if (result.success) return { kind: "ok" as const, value: result.data };
    return {
      kind: "schema" as const,
      message: result.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
          return `• ${path}: ${issue.message}`;
        })
        .join("\n"),
    };
  });

  $effect(() => {
    onValidityChange?.(validation.kind === "ok");
    if (validation.kind === "ok") onValidValue?.(validation.value);
  });

  function insertDefaults(): void {
    if (!jsonSchema) return;
    const out: Record<string, unknown> = {};
    for (const [name, prop] of Object.entries(jsonSchema.properties ?? {})) {
      if (prop && typeof prop === "object" && "default" in prop) out[name] = prop.default;
    }
    onchange(JSON.stringify(out, null, 2));
  }
</script>

<div class="space-y-1.5">
  {#if !readOnly && jsonSchema}
    <div class="flex justify-end">
      <button
        type="button"
        class="rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        onclick={insertDefaults}
      >
        Insert defaults
      </button>
    </div>
  {/if}
  <CodeEditor
    {value}
    onchange={onchange}
    language="json"
    {height}
    {readOnly}
    jsonSchema={jsonSchema}
    {onSubmitShortcut}
    {onEscapeShortcut}
    {resizable}
    {minHeight}
    {maxHeight}
  />
  {#if validation.kind === "ok"}
    <div class="flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-1.5 text-xs text-success">
      <Icon name="check-circle" class="h-3.5 w-3.5 shrink-0" />
      <span>Valid</span>
    </div>
  {:else}
    <div class="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
      <Icon name="x-circle" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        <span class="font-semibold">
          {validation.kind === "syntax" ? "Invalid JSON" : "Does not match schema"}
        </span>
        <pre class="mt-0.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{validation.message}</pre>
      </div>
    </div>
  {/if}
  {#if schemaText}
    <ZodJsonSchemaView {schemaText} />
  {/if}
</div>
