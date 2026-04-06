import { ChatMessage } from "@/types/agent";
import { Activity, Zap, Wrench } from "lucide-react";

interface ActivityPanelProps {
  messages: ChatMessage[];
}

export function ActivityPanel({ messages }: ActivityPanelProps) {
  const llmRequests = messages.filter((m) => m.llmRequest).map((m) => m.llmRequest!);
  const allToolCalls = messages.flatMap((m) => m.toolCalls || []);

  const totalTokens = llmRequests.reduce(
    (sum, r) => sum + r.promptTokens + r.completionTokens,
    0
  );
  const totalDuration = llmRequests.reduce((sum, r) => sum + r.durationMs, 0);

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Activity className="w-4 h-4 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Activity
        </h3>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-secondary/50 p-2.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            LLM Calls
          </div>
          <div className="text-lg font-semibold text-foreground font-mono">
            {llmRequests.length}
          </div>
        </div>
        <div className="rounded-md bg-secondary/50 p-2.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Tool Calls
          </div>
          <div className="text-lg font-semibold text-foreground font-mono">
            {allToolCalls.length}
          </div>
        </div>
        <div className="rounded-md bg-secondary/50 p-2.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Tokens
          </div>
          <div className="text-lg font-semibold text-foreground font-mono">
            {totalTokens.toLocaleString()}
          </div>
        </div>
        <div className="rounded-md bg-secondary/50 p-2.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Latency
          </div>
          <div className="text-lg font-semibold text-foreground font-mono">
            {(totalDuration / 1000).toFixed(1)}s
          </div>
        </div>
      </div>

      {/* Recent activity log */}
      <div>
        <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground px-1 mb-2">
          Timeline
        </h4>
        <div className="space-y-1">
          {llmRequests.map((req) => (
            <div
              key={req.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-secondary/30 text-xs"
            >
              <Zap className="w-3 h-3 text-primary shrink-0" />
              <span className="font-mono text-muted-foreground truncate">
                {req.model.split("/").pop()}
              </span>
              <span className="ml-auto text-muted-foreground font-mono">
                {(req.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
          ))}
          {allToolCalls.map((tc) => (
            <div
              key={tc.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-secondary/30 text-xs"
            >
              <Wrench className="w-3 h-3 text-agent-glow-muted shrink-0" />
              <span className="font-mono text-muted-foreground truncate">
                {tc.toolName}
              </span>
              <span
                className={`ml-auto text-[10px] font-medium ${
                  tc.status === "completed"
                    ? "text-success"
                    : tc.status === "failed"
                    ? "text-destructive"
                    : "text-warning"
                }`}
              >
                {tc.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
