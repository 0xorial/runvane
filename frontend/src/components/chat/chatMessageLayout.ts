import { cn } from "@/lib/utils";

export const chatUserBubble = cn(
  "flex w-full flex-col gap-2 rounded-[10px] border border-border bg-primary/10 px-3 py-2.5",
);

export const chatAssistantBubble = cn(
  "rounded-[10px] border border-border bg-card px-3 py-2.5",
);

/** Tool / planner rows — no outer bordered card */
export const chatToolOuter = "w-full min-w-0";
