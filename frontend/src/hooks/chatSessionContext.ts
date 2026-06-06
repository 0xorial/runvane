import { createContext, useCallback, useContext, useState } from "react";
import type { ChatSessionStore } from "@/lib/chatSessionStore";
import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
import type { ObservableItem } from "../utils/observableCollection";

export type ThoughtStage = "context" | "reasoning" | "action";

export type ChatSessionContextValue = {
  conversationId: string | null;
  sessionStore: ChatSessionStore;
  activePathEntries: ObservableItem<LinkedChatEntry>[];
  allEntries: ObservableItem<LinkedChatEntry>[];
  setActiveLeaf: (entryId: string) => Promise<void>;
  /** Choose a fork sibling; persists server default-view-leaf at that line's tip. */
  switchToBranch: (branchEntryId: string) => Promise<void>;
  /** Open chip per thought slot. Slot key = entry id stable across reasoning/context branches (e.g. prepare.parentId). */
  expandedStageBySlotKey: ReadonlyMap<string, ThoughtStage>;
  setSlotExpandedStage: (slotKey: string, stage: ThoughtStage | null) => void;
};

export const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

export function useChatSessionContext(): ChatSessionContextValue {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSessionContext must be used inside <ChatSessionContext.Provider>");
  return ctx;
}

export function useThoughtExpandedStageState() {
  const [expandedStageBySlotKey, setMap] = useState<ReadonlyMap<string, ThoughtStage>>(() => new Map());
  const setSlotExpandedStage = useCallback((slotKey: string, stage: ThoughtStage | null) => {
    setMap((prev) => {
      const next = new Map(prev);
      if (stage === null) next.delete(slotKey);
      else next.set(slotKey, stage);
      return next;
    });
  }, []);
  return { expandedStageBySlotKey, setSlotExpandedStage };
}
