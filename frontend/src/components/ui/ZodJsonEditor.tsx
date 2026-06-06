import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { CheckCircle2, XCircle, ChevronRight, ChevronDown } from "lucide-react";
import { CodeEditor } from "./CodeEditor";

type ZodJsonEditorProps<T> = {
  /** The Zod schema the JSON is validated against — the single source of truth. */
  schema: z.ZodType<T>;
  /** Current editor text (raw JSON string). */
  value: string;
  /** Fired on every keystroke with the raw text. */
  onChange: (text: string) => void;
  /** Fired whenever the text is valid, with the parsed + schema-checked value. */
  onValidValue?: (value: T) => void;
  /** Fired on every validation pass with the current validity. */
  onValidityChange?: (valid: boolean) => void;
  /** Editor body height in px. */
  height?: number;
  /** Render the editor read-only. */
  readOnly?: boolean;
  /** Cmd/Ctrl+Enter — e.g. submit reprocess edits. */
  onSubmitShortcut?: () => void;
};

type Validation<T> =
  | { kind: "ok"; value: T }
  | { kind: "syntax"; message: string }
  | { kind: "schema"; message: string };

/** Render Zod issues as a friendly, path-prefixed list. */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `• ${path}: ${issue.message}`;
    })
    .join("\n");
}

/** A loose view of the JSON Schema `z.toJSONSchema` produces. */
type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, { default?: unknown }>;
};

/** Build an all-defaults object from every top-level property with a `default`. */
function buildDefaults(root: JsonSchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(root.properties ?? {})) {
    if (prop && typeof prop === "object" && "default" in prop) out[name] = prop.default;
  }
  return out;
}

/** Collapsible read-only view of the schema in its JSON Schema form. */
function SchemaView({ schemaText }: { schemaText: string }) {
  const [open, setOpen] = useState(false);
  // Size to content, clamped — schemas range from a few lines to deeply nested.
  const lineCount = schemaText.split("\n").length;
  const viewHeight = Math.min(Math.max(lineCount * 18, 80), 360);
  return (
    <div className="rounded-md border border-border/60 bg-muted/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-2.5 py-1.5 text-left font-semibold text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span>Schema</span>
        <span className="font-normal text-muted-foreground">(JSON Schema)</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2">
          <CodeEditor value={schemaText} language="json" height={viewHeight} readOnly />
        </div>
      )}
    </div>
  );
}

/**
 * A Monaco JSON editor bound to a Zod schema. Three layers:
 *  - Monaco's JSON-Schema service (inline squiggles + autocomplete + hover
 *    docs), fed a JSON Schema derived from the Zod schema.
 *  - Zod `safeParse` (authoritative) driving the friendly error panel below.
 *  - A collapsible read-only view of the schema itself (JSON Schema form).
 */
export function ZodJsonEditor<T>({
  schema,
  value,
  onChange,
  onValidValue,
  onValidityChange,
  height,
  readOnly,
  onSubmitShortcut,
}: ZodJsonEditorProps<T>) {
  // Derive a JSON Schema for Monaco's inline diagnostics and the schema view.
  // Schemas with constructs JSON Schema cannot express (transforms, some
  // refinements) make this throw — fall back gracefully; Zod still validates.
  const jsonSchema = useMemo(() => {
    try {
      return z.toJSONSchema(schema) as JsonSchemaNode;
    } catch {
      return undefined;
    }
  }, [schema]);

  const schemaText = useMemo(
    () => (jsonSchema ? JSON.stringify(jsonSchema, null, 2) : undefined),
    [jsonSchema],
  );

  const validation = useMemo<Validation<T>>(() => {
    const text = value.trim();
    if (!text) return { kind: "syntax", message: "Empty — expected a JSON object." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { kind: "syntax", message: e instanceof Error ? e.message : "Invalid JSON." };
    }
    const result = schema.safeParse(parsed);
    if (result.success) return { kind: "ok", value: result.data };
    return { kind: "schema", message: formatIssues(result.error) };
  }, [value, schema]);

  useEffect(() => {
    onValidityChange?.(validation.kind === "ok");
    if (validation.kind === "ok") onValidValue?.(validation.value);
  }, [validation, onValidValue, onValidityChange]);

  const insertDefaults = () => {
    if (!jsonSchema) return;
    onChange(JSON.stringify(buildDefaults(jsonSchema), null, 2));
  };

  return (
    <div className="space-y-1.5">
      {!readOnly && jsonSchema && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={insertDefaults}
            className="rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Insert defaults
          </button>
        </div>
      )}
      <CodeEditor
        value={value}
        onChange={onChange}
        language="json"
        height={height}
        readOnly={readOnly}
        jsonSchema={jsonSchema}
        onSubmitShortcut={onSubmitShortcut}
      />
      {validation.kind === "ok" ? (
        <div className="flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-1.5 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Valid</span>
        </div>
      ) : (
        <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-semibold">
              {validation.kind === "syntax" ? "Invalid JSON" : "Does not match schema"}
            </span>
            <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {validation.message}
            </pre>
          </div>
        </div>
      )}
      {schemaText && <SchemaView schemaText={schemaText} />}
    </div>
  );
}
