export type ContinueConversationTask = {
  conversationId: string;
  sourceEntryId?: string;
};

export type RunToolTask = {
  conversationId: string;
  sourceEntryId?: string;
  agentId: string | null;
  toolName: string;
  params: unknown;
  toolRequest?: string;
  plannerFollowup?: {
    mode: "continue" | "finalize";
    userText: string;
    enabledToolIds: string[];
  };
  approvalGranted?: boolean;
  agentToolConfig?: {
    enabled?: boolean;
    policy?: "allow" | "ask_user" | "forbid";
    rules?: Record<string, unknown>;
  };
};
