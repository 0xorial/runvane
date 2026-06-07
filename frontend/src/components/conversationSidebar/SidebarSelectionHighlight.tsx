import { useLayoutEffect, useRef } from "react";

export const CONVERSATION_SIDEBAR_LIST_ID = "conversation-sidebar-list";

type SidebarSelectionHighlightProps = {
  activeConversationId: string | null;
};

function rowForId(root: HTMLElement, conversationId: string): HTMLElement | null {
  const el = root.querySelector(`[data-conversation-row][data-conversation-id="${CSS.escape(conversationId)}"]`);
  return el instanceof HTMLElement ? el : null;
}

/** Null-render: flips row highlight in the DOM without re-rendering the sidebar list. */
export function SidebarSelectionHighlight({ activeConversationId }: SidebarSelectionHighlightProps) {
  const previousActiveIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const root = document.getElementById(CONVERSATION_SIDEBAR_LIST_ID);
    if (!root) return;

    const previousActiveId = previousActiveIdRef.current;
    const nextActiveId = activeConversationId?.trim() || null;

    if (previousActiveId && previousActiveId !== nextActiveId) {
      const previousRow = rowForId(root, previousActiveId);
      if (previousRow) previousRow.dataset.active = "false";
    }

    if (nextActiveId) {
      const nextRow = rowForId(root, nextActiveId);
      if (nextRow) nextRow.dataset.active = "true";
    }

    previousActiveIdRef.current = nextActiveId;
  }, [activeConversationId]);

  return null;
}
