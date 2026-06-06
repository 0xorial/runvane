import { useEffect, useId, useRef, useState } from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

// Bundle Monaco locally instead of pulling it from a CDN — this app runs
// against local LLM backends and must work fully offline. Monaco is heavy
// (~3.5MB) but CodeEditor is lazy-loaded into its own chunk (see CodeEditor.tsx),
// so it stays out of the main bundle.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

/**
 * Per-editor JSON Schema registry. Monaco's JSON language service is
 * configured globally, so each editor registers its schema (scoped to its
 * own model URI via `fileMatch`) and we re-apply the merged set.
 */
type SchemaEntry = { uri: string; fileMatch: string[]; schema: object };
const schemaRegistry = new Map<string, SchemaEntry>();

// monaco 0.55 type-tombstones the `languages.json` namespace (its declared
// type is `{ deprecated: true }`), but the barrel build still wires
// `monaco.languages.json` to the json contribution module at runtime
// (editor.main.js: `monacoApi.languages.json = ...`). Cast to the shape we use.
type JsonLanguageDefaults = {
  setDiagnosticsOptions(opts: {
    validate?: boolean;
    enableSchemaRequest?: boolean;
    schemas?: SchemaEntry[];
  }): void;
};

function jsonDefaults(): JsonLanguageDefaults {
  return (monaco.languages.json as unknown as { jsonDefaults: JsonLanguageDefaults }).jsonDefaults;
}

function applySchemas(): void {
  jsonDefaults().setDiagnosticsOptions({
    validate: true,
    enableSchemaRequest: false,
    schemas: Array.from(schemaRegistry.values()),
  });
}

/** Tracks the app's dark/light mode from the documentElement `dark` class. */
function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setDark(el.classList.contains("dark")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export type CodeEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  language?: "json" | "markdown" | "plaintext";
  /** Editor body height in px. */
  height?: number;
  readOnly?: boolean;
  /**
   * JSON Schema for live validation + autocomplete. Only meaningful when
   * `language` is "json". Pass the output of `z.toJSONSchema(...)`.
   */
  jsonSchema?: object;
  /** Cmd/Ctrl+Enter — e.g. submit reprocess edits. */
  onSubmitShortcut?: () => void;
};

function CodeEditorImpl({
  value,
  onChange,
  language = "json",
  height = 220,
  readOnly = false,
  jsonSchema,
  onSubmitShortcut,
}: CodeEditorProps) {
  const isDark = useIsDark();
  const onSubmitShortcutRef = useRef(onSubmitShortcut);
  onSubmitShortcutRef.current = onSubmitShortcut;
  // Unique, stable model path for this editor instance so its schema can be
  // scoped to its own model without affecting other open editors.
  const rawId = useId();
  const modelPath = `entry-editor-${rawId.replace(/[^a-zA-Z0-9]/g, "")}.json`;
  // The real model URI, captured at mount. `fileMatch` must be matched against
  // this exact string — globbing a bare filename is unreliable (a slash-less
  // URI never matches the `**/...` glob Monaco derives from it).
  const [modelUri, setModelUri] = useState<string | null>(null);

  const handleMount: OnMount = (editor, monacoApi) => {
    const uri = editor.getModel()?.uri.toString();
    if (uri) setModelUri(uri);
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Enter, () => {
      onSubmitShortcutRef.current?.();
    });
  };

  useEffect(() => {
    if (!jsonSchema || !modelUri) return;
    schemaRegistry.set(modelUri, {
      uri: `schema://entry-editor/${modelPath}`,
      fileMatch: [modelUri],
      schema: jsonSchema,
    });
    applySchemas();
    return () => {
      schemaRegistry.delete(modelUri);
      applySchemas();
    };
  }, [jsonSchema, modelUri, modelPath]);

  return (
    <div className="overflow-hidden rounded border border-border/70">
      <Editor
        height={height}
        language={language}
        path={language === "json" ? modelPath : undefined}
        value={value}
        theme={isDark ? "vs-dark" : "vs"}
        onMount={handleMount}
        onChange={(next) => onChange?.(next ?? "")}
        options={{
          readOnly,
          minimap: { enabled: false },
          wordWrap: "on",
          fontSize: 12,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          renderLineHighlight: "none",
          overviewRulerLanes: 0,
          // JSON property keys and enum values live inside "..."; Monaco
          // suppresses quick suggestions in strings by default, which hides
          // schema-driven autocomplete. Enable it so completions auto-pop.
          quickSuggestions: { other: true, comments: false, strings: true },
          suggestOnTriggerCharacters: true,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          padding: { top: 6, bottom: 6 },
        }}
      />
    </div>
  );
}

export default CodeEditorImpl;
