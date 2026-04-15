import { ToolCall } from "@/types/agent";
import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldQuestion,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

interface ToolCallBlockProps {
  toolCall: ToolCall;
  onApprove?: (toolCallId: string) => void;
  onDeny?: (toolCallId: string) => void;
}

const statusConfig = {
  pending: { icon: Loader2, label: "Pending", className: "text-muted-foreground" },
  running: { icon: Loader2, label: "Running", className: "text-primary animate-spin" },
  completed: { icon: CheckCircle2, label: "Done", className: "text-success" },
  failed: { icon: XCircle, label: "Failed", className: "text-destructive" },
  awaiting_approval: { icon: ShieldQuestion, label: "Awaiting approval", className: "text-warning animate-pulse-glow" },
};

export function ToolCallBlock({ toolCall, onApprove, onDeny }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(toolCall.status === "awaiting_approval");
  const config = statusConfig[toolCall.status];
  const StatusIcon = config.icon;
  const duration = toolCall.completedAt ? `${toolCall.completedAt - toolCall.startedAt}ms` : null;

  const isAwaiting = toolCall.status === "awaiting_approval";

  return (
    <div
      className={`rounded-md border overflow-hidden ${isAwaiting ? "border-warning/40 bg-warning/5" : "bg-secondary/50"}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        )}
        <Wrench className="w-3 h-3 text-primary" />
        <span className="font-mono font-medium text-foreground">{toolCall.toolName}</span>
        <StatusIcon className={`w-3 h-3 ml-auto ${config.className}`} />
        <span className={`text-[10px] font-medium ${isAwaiting ? "text-warning" : "text-muted-foreground"}`}>
          {isAwaiting ? "Needs approval" : duration}
        </span>
      </button>

      {expanded && (
        <div className="border-t px-3 py-2 space-y-2 animate-slide-in">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Arguments</span>
            <pre className="text-xs font-mono text-secondary-foreground mt-1 bg-background rounded p-2 overflow-x-auto">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Result</span>
              <pre className="text-xs font-mono text-secondary-foreground mt-1 bg-background rounded p-2 overflow-x-auto max-h-40 overflow-y-auto scrollbar-thin">
                {toolCall.result}
              </pre>
            </div>
          )}
          {isAwaiting && (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove?.(toolCall.id);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-success/15 text-success hover:bg-success/25 transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Approve
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeny?.(toolCall.id);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
              >
                <ShieldOff className="w-3.5 h-3.5" />
                Deny
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
