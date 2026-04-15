export type ConversationRow = {
  id: string;
  title?: string;
  group_id?: string | null;
  is_deleted?: boolean;
  created_at?: string;
  updated_at?: string;
  prompt_tokens_total?: number;
  cached_prompt_tokens_total?: number;
  completion_tokens_total?: number;
  token_usage_by_model?: Array<{
    model_name: string;
    prompt_tokens: number;
    cached_prompt_tokens: number;
    completion_tokens: number;
  }>;
};

export type ConversationGroupRow = {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
};
