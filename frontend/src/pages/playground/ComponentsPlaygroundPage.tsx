import { ThinkingComponentPlayground } from "./ThinkingComponentPlayground";
import { ToolComponentPlayground } from "./ToolComponentPlayground";

export function ComponentsPlaygroundPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <h1 className="text-xl font-bold tracking-tight">Components Playground</h1>
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Thinking Component</h2>
        <ThinkingComponentPlayground />
      </section>
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Tool Invocation Row</h2>
        <ToolComponentPlayground />
      </section>
    </div>
  );
}
