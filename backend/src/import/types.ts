export type NormalizedImportMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type NormalizedImportConversation = {
  title: string;
  messages: NormalizedImportMessage[];
};

export type ImportResult = {
  imported: number;
  conversationIds: string[];
};
