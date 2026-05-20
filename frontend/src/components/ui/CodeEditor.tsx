import { lazy, Suspense } from "react";
import type { CodeEditorProps } from "./CodeEditorImpl";

// Monaco is large (~3MB). Load it as its own chunk only when an editor is
// actually rendered (i.e. when the user opens an entry for editing), keeping
// it out of the main app bundle.
const CodeEditorImpl = lazy(() => import("./CodeEditorImpl"));

export function CodeEditor(props: CodeEditorProps) {
  const height = props.height ?? 220;
  return (
    <Suspense
      fallback={
        <div
          className="flex items-center justify-center rounded border border-border/70 bg-muted/40 text-[11px] text-muted-foreground"
          style={{ height }}
        >
          Loading editor…
        </div>
      }
    >
      <CodeEditorImpl {...props} />
    </Suspense>
  );
}

export type { CodeEditorProps };
