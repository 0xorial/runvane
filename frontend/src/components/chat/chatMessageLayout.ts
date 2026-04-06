import { cn } from "@/lib/utils";

export const chatUserBubble = cn(
  "flex w-full flex-col gap-1 rounded-lg border border-border bg-primary/10 px-2 py-1.5",
);

export const chatAssistantBubble = cn(
  "rounded-lg border border-border bg-card px-2 py-1.5",
);

/** Tool / planner rows — no outer bordered card */
export const chatToolOuter = "w-full min-w-0";
