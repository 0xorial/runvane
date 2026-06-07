import type { ReactNode } from "react";
import { CONVERSATION_SIDEBAR_LIST_ID } from "./SidebarSelectionHighlight";

type ConversationSidebarListProps = {
  children: ReactNode;
};

export function ConversationSidebarList({ children }: ConversationSidebarListProps) {
  return (
    <div
      id={CONVERSATION_SIDEBAR_LIST_ID}
      className="scrollbar-thin flex h-full min-h-0 flex-1 flex-col space-y-0.5 overflow-y-auto overflow-x-hidden overscroll-contain px-1.5 py-1.5"
    >
      {children}
    </div>
  );
}
