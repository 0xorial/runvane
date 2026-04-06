import type { ReactNode } from "react";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatMessageRole = "user" | "agent";

type ChatMessageShellProps = {
  role: ChatMessageRole;
  /** Optional pill after label (e.g. model / tokens) — mirrors frontend2 LLMRequestBadge */
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Layout from frontend2/src/components/chat/ChatMessage.tsx */
export function ChatMessageShell({ role, badge, children, className }: ChatMessageShellProps) {
  const isUser = role === "user";
  return (
    <div
      className={cn(
        "animate-slide-in group py-1.5",
        isUser && "mt-7 first:mt-0",
        className,
      )}
    >
      <div className="mx-auto flex max-w-3xl gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            isUser ? "bg-secondary" : "bg-primary/10 glow-accent-sm",
          )}
        >
          {isUser ? (
            <User className="h-4 w-4 text-secondary-foreground" />
          ) : (
            <Bot className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {isUser ? "You" : "Agent"}
            </span>
            {badge}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Same width rail as ChatMessageShell but empty — for tool / planner rows that sit in the agent column.
 * Mirrors nesting under agent content in frontend2.
 */
export function ChatThreadIndent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("animate-slide-in group pt-0.5 pb-0", className)}>
      <div className="mx-auto flex max-w-3xl items-start gap-3">
        {/* Width-only gutter: do not set h-7 — that forces a 28px-tall row and leaves a gap under one-line rows */}
        <div className="w-7 shrink-0 self-start" aria-hidden />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
