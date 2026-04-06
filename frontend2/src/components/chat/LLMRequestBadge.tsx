import { LLMRequest } from "@/types/agent";
import { Zap } from "lucide-react";

interface LLMRequestBadgeProps {
  request: LLMRequest;
}

export function LLMRequestBadge({ request }: LLMRequestBadgeProps) {
  const totalTokens = request.promptTokens + request.completionTokens;

  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-secondary text-[10px] font-mono text-muted-foreground">
      <Zap className="w-2.5 h-2.5 text-primary" />
      <span>{request.model.split("/").pop()}</span>
      <span className="text-border">•</span>
      <span>{totalTokens.toLocaleString()} tok</span>
      <span className="text-border">•</span>
      <span>{(request.durationMs / 1000).toFixed(1)}s</span>
    </div>
  );
}
