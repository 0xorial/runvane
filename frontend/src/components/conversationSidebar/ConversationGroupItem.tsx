import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import {
  formatExactChatTime,
  formatRelativeChatTime,
} from "../../utils/formatRelativeChatTime";
import type { ConversationRow } from "./types";

type ConversationGroupItemProps = {
  groupName: string;
  rows: ConversationRow[];
  latestTimestampIso?: string;
  collapsed: boolean;
  onToggle: () => void;
  renderConversationRow: (conversation: ConversationRow, opts?: { nested?: boolean }) => JSX.Element;
};

export function ConversationGroupItem({
  groupName,
  rows,
  latestTimestampIso,
  collapsed,
  onToggle,
  renderConversationRow,
}: ConversationGroupItemProps) {
  const stamp = formatRelativeChatTime(latestTimestampIso);
  const stampExact = formatExactChatTime(latestTimestampIso);

  return (
    <div className="pt-1">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1 text-left">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{groupName}</span>
          </span>
          {stamp ? (
            <span className="ml-5 mt-0.5 block truncate text-[10px] text-muted-foreground" title={stampExact}>
              {stamp}
            </span>
          ) : null}
        </span>
        <span className="ml-2 shrink-0 self-start pt-0.5 text-[10px] text-muted-foreground">
          {rows.length}
        </span>
      </button>
      {collapsed ? null : (
        <div className="mt-0.5 flex flex-col gap-0.5">
          {rows.map((conversation) => renderConversationRow(conversation, { nested: true }))}
        </div>
      )}
    </div>
  );
}
