import { createContext, useContext } from "react";

export type ChatSessionContextValue = {
  conversationId: string | null;
  refreshChat: () => Promise<void>;
};

export const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

export function useChatSessionContext(): ChatSessionContextValue {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSessionContext must be used inside <ChatSessionContext.Provider>");
  return ctx;
}
