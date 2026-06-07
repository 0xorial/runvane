import { getContext, setContext } from "svelte";
import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
import type { ObservableItem } from "@/utils/observableCollection";

export type ChatSessionContext = {
  getConversationId: () => string | null;
  getActivePathEntries: () => ObservableItem<LinkedChatEntry>[];
  setActiveLeaf: (entryId: string) => Promise<void>;
  switchToBranch: (branchEntryId: string) => Promise<void>;
  siblingsOf: (entryId: string) => LinkedChatEntry[];
};

const CHAT_SESSION_KEY = Symbol("chatSession");

export function setChatSessionContext(ctx: ChatSessionContext): void {
  setContext(CHAT_SESSION_KEY, ctx);
}

export function getChatSessionContext(): ChatSessionContext {
  return getContext<ChatSessionContext>(CHAT_SESSION_KEY);
}
