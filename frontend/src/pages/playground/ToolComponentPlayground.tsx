import { ToolRunRow } from "../../components/chat/rows/ToolRunRow";
import type { ToolInvocationEntry } from "../../protocol/chatEntry";

const now = new Date().toISOString();

const mockEnvelope = (
  ok: boolean,
  output: unknown,
  error: string | null,
  permission_state: "allow" | "ask_user" | "forbid" = "allow",
) => ({
  ok,
  toolId: "tool",
  output,
  error,
  permission_state,
  timing: { started_at: now, finished_at: now, elapsed_ms: 0 },
});

export function ToolComponentPlayground() {
  const scenarios: Array<{ label: string; entry: ToolInvocationEntry }> = [
    {
      label: "Requested — permission",
      entry: {
        type: "tool-invocation",
        id: "playground-tool-requested",
        conversationIndex: 0,
        createdAt: now,
        parentId: null,
        toolId: "curl",
        state: "requested",
        parameters: { url: "https://example.com", method: "GET" },
        result: mockEnvelope(false, null, "Tool requires user approval.", "ask_user"),
      },
    },
    {
      label: "Requested — guardrail flagged",
      entry: {
        type: "tool-invocation",
        id: "playground-tool-guardrail",
        conversationIndex: 1,
        createdAt: now,
        parentId: null,
        toolId: "bash",
        state: "requested",
        parameters: { command: "cat /etc/passwd" },
        result: mockEnvelope(false, null, "Guardrail flagged: command reads system credential files outside target scope", "ask_user"),
      },
    },
    {
      label: "Running",
      entry: {
        type: "tool-invocation",
        id: "playground-tool-running",
        conversationIndex: 2,
        createdAt: now,
        parentId: null,
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
        conversationIndex: 3,
        createdAt: now,
        parentId: null,
        toolId: "get_current_time",
        state: "done",
        parameters: {},
        result: mockEnvelope(true, { iso: now }, null),
      },
    },
    {
      label: "Error",
      entry: {
        type: "tool-invocation",
        id: "playground-tool-error",
        conversationIndex: 4,
        createdAt: now,
        parentId: null,
        toolId: "curl",
        state: "error",
        parameters: { url: "http://localhost:3000/private", method: "GET" },
        result: mockEnvelope(false, null, "curl: blocked local host 'localhost'", "forbid"),
      },
    },
  ];

  return (
    <section className="flex flex-col gap-4">
      {scenarios.map((row) => (
        <div key={row.entry.id} className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{row.label}</div>
          <ToolRunRow entry={row.entry} />
        </div>
      ))}
    </section>
  );
}
