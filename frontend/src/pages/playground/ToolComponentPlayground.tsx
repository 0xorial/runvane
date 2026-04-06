import { ToolRunRow } from "../../components/chat/rows/ToolRunRow";
import type { ToolInvocationEntry } from "../../protocol/chatEntry";

export function ToolComponentPlayground() {
  const scenarios: Array<{ label: string; entry: ToolInvocationEntry }> = [
    {
      label: "Requested",
      entry: {
        type: "tool-invocation",
        id: "playground-tool-requested",
        conversationIndex: 0,
        createdAt: new Date().toISOString(),
        toolId: "curl",
        state: "requested",
        parameters: { url: "https://example.com", method: "GET" },
        result: "Tool requires user approval.",
      },
    },
    {
      label: "Running",
      entry: {
        type: "tool-invocation",
        id: "playground-tool-running",
        conversationIndex: 1,
        createdAt: new Date().toISOString(),
        toolId: "curl",
        state: "running",
        parameters: { url: "https://api.github.com/repos/octocat/Hello-World", method: "GET" },
        result: null,
      },
    },
    {
      label: "Done",
      entry: {
        type: "tool-invocation",
        id: "playground-tool-done",
        conversationIndex: 2,
        createdAt: new Date().toISOString(),
        toolId: "get_current_time",
        state: "done",
        parameters: {},
        result: { nowIso: "2026-04-01T19:10:12.456Z" },
      },
    },
    {
      label: "Error",
      entry: {
        type: "tool-invocation",
        id: "playground-tool-error",
        conversationIndex: 3,
        createdAt: new Date().toISOString(),
        toolId: "curl",
        state: "error",
        parameters: { url: "http://localhost:3000/private", method: "GET" },
        result: "curl: blocked local host 'localhost'",
      },
    },
  ];

  return (
    <section className="flex flex-col gap-4">
      {scenarios.map((row) => (
        <div key={row.entry.id} className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {row.label}
          </div>
          <ToolRunRow entry={row.entry} />
        </div>
      ))}
    </section>
  );
}
