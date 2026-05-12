import { createContext, useContext } from "react";
import type { ChatEntry } from "../protocol/chatEntry";
import type { ObservableItem } from "../utils/observableCollection";

export type ChatSessionContextValue = {
  conversationId: string | null;
  activePathEntries: ObservableItem<ChatEntry>[];
  allEntries: ObservableItem<ChatEntry>[];
  activeLeafId: string | null;
  setActiveLeaf: (entryId: string) => Promise<void>;
};

export const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

export function useChatSessionContext(): ChatSessionContextValue {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSessionContext must be used inside <ChatSessionContext.Provider>");
  return ctx;
}
