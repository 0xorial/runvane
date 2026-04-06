import { ChatMessage as ChatMessageType } from "@/types/agent";
import { ToolCallBlock } from "./ToolCallBlock";
import { LLMRequestBadge } from "./LLMRequestBadge";
import { Bot, User } from "lucide-react";

interface ChatMessageProps {
  message: ChatMessageType;
  onToolApprove?: (toolCallId: string) => void;
  onToolDeny?: (toolCallId: string) => void;
}

export function ChatMessage({ message, onToolApprove, onToolDeny }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className="animate-slide-in group py-4">
      <div className="flex gap-3 max-w-3xl mx-auto">
        <div
          className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
            isUser ? "bg-secondary" : "bg-primary/10 glow-accent-sm"
          }`}
        >
          {isUser ? (
            <User className="w-4 h-4 text-secondary-foreground" />
          ) : (
            <Bot className="w-4 h-4 text-primary" />
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {isUser ? "You" : "Agent"}
            </span>
            {message.llmRequest && (
              <LLMRequestBadge request={message.llmRequest} />
            )}
          </div>

          <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
            {message.content}
          </div>

          {message.toolCalls?.map((tc) => (
            <ToolCallBlock
              key={tc.id}
              toolCall={tc}
              onApprove={onToolApprove}
              onDeny={onToolDeny}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
