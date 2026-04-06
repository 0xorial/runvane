export type MessageRole = "user" | "assistant" | "system" | "tool";

export type ToolPermission = "allow" | "ask" | "forbid";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  permission: ToolPermission;
  category: string;
}

export interface ToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  status: "pending" | "running" | "completed" | "failed" | "awaiting_approval";
  startedAt: number;
  completedAt?: number;
}

export interface LLMRequest {
  id: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  timestamp: number;
  durationMs: number;
  status: "pending" | "streaming" | "completed" | "error";
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  llmRequest?: LLMRequest;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
