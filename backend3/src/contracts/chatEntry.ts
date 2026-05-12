export type ChatEntryBase = {
  id: string;
  conversationIndex: number;
  createdAt: string;
  parentId: string | null;
};

export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

export type UserMessageEntry = ChatEntryBase & {
  type: 'user-message';
  text: string;
  agentId: string;
  llmProviderId?: string;
  llmModel?: string;
  modelPresetId?: number | null;
  attachments?: ChatAttachment[];
};

export type ThoughtStepStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type LlmDecisionTool = {
  type: 'tool-invocation';
  toolId: string;
  parameters: Record<string, unknown>;
};

export type LlmDecisionUserResponse = {
  type: 'user-response';
  text: string;
};

export type LlmDecision = LlmDecisionTool | LlmDecisionUserResponse;

export type AgenticToolCall = {
  toolId: string;
  parameters: Record<string, unknown>;
};

export type AgenticToolRequest = {
  tool_name: string;
  request: string;
};

export type AgenticPlannerOutput = {
  assistant_output?: string;
  tool_calls: AgenticToolCall[];
  tool_requests: AgenticToolRequest[];
  followup: 'finalize' | 'continue';
};

export type ThoughtPrepareEntry = ChatEntryBase & {
  type: 'thought-prepare';
  thoughtId: string;
  status?: ThoughtStepStatus;
  error?: string;
  requestText?: string;
  title?: string;
  llmProviderId?: string;
  llmModel?: string;
};

type ThoughtStreamEntryShape = {
  thoughtId: string;
  llmRequest: string;
  llmProviderId?: string;
  llmResponse?: string;
  thoughtMs?: number | null;
  decision?: LlmDecision | null;
  status?: ThoughtStepStatus;
  error?: string;
  llmModel?: string;
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
};

export type PlannerLlmStreamEntry = ChatEntryBase &
  ThoughtStreamEntryShape & {
    type: 'planner_llm_stream';
    parseResult?: { status: 'ok'; parsed: AgenticPlannerOutput } | { status: 'error'; error: string };
  };

export type TitleLlmStreamEntry = ChatEntryBase &
  ThoughtStreamEntryShape & {
    type: 'title_llm_stream';
  };

export type ToolParamsLlmStreamEntry = ChatEntryBase &
  ThoughtStreamEntryShape & {
    type: 'tool_params_llm_stream';
  };

export type ThoughtActionEntry = ChatEntryBase & {
  type: 'thought-action';
  thoughtId: string;
  status: ThoughtStepStatus;
  summary?: string;
  action?: string;
  toolName?: string;
  error?: string;
  parseResult?: { status: 'ok'; parsed: AgenticPlannerOutput } | { status: 'error'; error: string };
};

export type ToolInvocationEntry = ChatEntryBase & {
  type: 'tool-invocation';
  toolId: string;
  state: 'requested' | 'running' | 'done' | 'error';
  parameters: Record<string, unknown>;
  result: unknown;
};

export type AssistantMessageEntry = ChatEntryBase & {
  type: 'assistant-message';
  text: string;
};

export type ChatEntry =
  | UserMessageEntry
  | ThoughtPrepareEntry
  | PlannerLlmStreamEntry
  | ThoughtActionEntry
  | TitleLlmStreamEntry
  | ToolParamsLlmStreamEntry
  | ToolInvocationEntry
  | AssistantMessageEntry;
