import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

type SchemaEntry = { uri: string; fileMatch: string[]; schema: object };

type JsonLanguageDefaults = {
  setDiagnosticsOptions(opts: {
    validate?: boolean;
    enableSchemaRequest?: boolean;
    schemas?: SchemaEntry[];
  }): void;
};

const schemaRegistry = new Map<string, SchemaEntry>();
let monacoConfigured = false;

export function ensureMonacoWorkers(): void {
  if (monacoConfigured) return;
  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === "json") return new jsonWorker();
      return new editorWorker();
    },
  };
  monacoConfigured = true;
}

export function registerJsonSchema(modelUri: string, modelPath: string, schema: object): void {
  schemaRegistry.set(modelUri, {
    uri: `schema://entry-editor/${modelPath}`,
    fileMatch: [modelUri],
    schema,
  });
  applySchemas();
}

export function unregisterJsonSchema(modelUri: string): void {
  schemaRegistry.delete(modelUri);
  applySchemas();
}

function applySchemas(): void {
  import("monaco-editor").then((monaco) => {
    jsonDefaults(monaco).setDiagnosticsOptions({
      validate: true,
      enableSchemaRequest: false,
      schemas: Array.from(schemaRegistry.values()),
    });
  });
}

function jsonDefaults(monaco: typeof import("monaco-editor")): JsonLanguageDefaults {
  return (monaco.languages.json as unknown as { jsonDefaults: JsonLanguageDefaults }).jsonDefaults;
}

export function watchDarkMode(onChange: (dark: boolean) => void): () => void {
  const el = document.documentElement;
  const sync = () => onChange(el.classList.contains("dark"));
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(el, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
