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
  estimated_cost_usd?: number;
};

export type ConversationGroupRow = {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
};
