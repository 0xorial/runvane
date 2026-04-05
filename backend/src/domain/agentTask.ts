export const AgentTaskType = {
  CONTINUE_CONVERSATION: "continue_conversation",
  RUN_TOOL: "run_tool",
} as const;

export type ContinueConversationTask = {
  type: typeof AgentTaskType.CONTINUE_CONVERSATION;
  conversationId: string;
};

export type RunToolTask = {
  type: typeof AgentTaskType.RUN_TOOL;
  conversationId: string;
  agentId: string | null;
  toolName: string;
  params: unknown;
  toolInvocationEntryId?: string;
  approvalGranted?: boolean;
  agentToolConfig?: {
    enabled?: boolean;
    policy?: "allow" | "ask_user" | "forbid";
    rules?: Record<string, unknown>;
  };
};

export type AgentTask = ContinueConversationTask | RunToolTask;

export type TaskQueueHint = {
  taskId: number;
};
