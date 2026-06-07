import {
  ensureMonacoWorkers,
  registerJsonSchema,
  unregisterJsonSchema,
  watchDarkMode,
} from "./monacoEnv";

export type CodeEditorMountOptions = {
  value: string;
  language?: "json" | "markdown" | "plaintext";
  readOnly?: boolean;
  jsonSchema?: object;
  onChange?: (value: string) => void;
  onSubmitShortcut?: () => void;
};

export type CodeEditorHandle = {
  getValue: () => string;
  setValue: (value: string) => void;
  setReadOnly: (readOnly: boolean) => void;
  updateJsonSchema: (schema: object | undefined) => void;
  dispose: () => void;
};

export async function mountCodeEditor(
  container: HTMLElement,
  options: CodeEditorMountOptions,
): Promise<CodeEditorHandle> {
  ensureMonacoWorkers();
  const monaco = await import("monaco-editor");

  const language = options.language ?? "json";
  const modelPath = `entry-editor-${crypto.randomUUID().replace(/-/g, "")}.json`;
  const isDark = document.documentElement.classList.contains("dark");
  const model =
    language === "json"
      ? monaco.editor.createModel(options.value, language, monaco.Uri.parse(modelPath))
      : monaco.editor.createModel(options.value, language);

  const editor = monaco.editor.create(container, {
    model,
    theme: isDark ? "vs-dark" : "vs",
    readOnly: options.readOnly ?? false,
    minimap: { enabled: false },
    wordWrap: "on",
    fontSize: 12,
    lineNumbers: "on",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    renderLineHighlight: "none",
    overviewRulerLanes: 0,
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    padding: { top: 6, bottom: 6 },
  });

  const modelUri = model.uri.toString();
  let schema = options.jsonSchema;
  if (schema) registerJsonSchema(modelUri, modelPath, schema);

  const onChangeDisposable = editor.onDidChangeModelContent(() => {
    options.onChange?.(editor.getValue());
  });

  if (options.onSubmitShortcut) {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      options.onSubmitShortcut?.();
    });
  }

  const stopDarkWatch = watchDarkMode((dark) => {
    monaco.editor.setTheme(dark ? "vs-dark" : "vs");
  });

  return {
    getValue: () => editor.getValue(),
    setValue: (value) => {
      if (editor.getValue() !== value) editor.setValue(value);
    },
    setReadOnly: (readOnly) => editor.updateOptions({ readOnly }),
    updateJsonSchema: (next) => {
      if (schema) unregisterJsonSchema(modelUri);
      schema = next;
      if (schema) registerJsonSchema(modelUri, modelPath, schema);
    },
    dispose: () => {
      stopDarkWatch();
      onChangeDisposable.dispose();
      if (schema) unregisterJsonSchema(modelUri);
      editor.dispose();
      model.dispose();
    },
  };
}
