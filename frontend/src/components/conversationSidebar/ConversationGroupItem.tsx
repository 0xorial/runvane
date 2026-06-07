import { memo, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { formatExactChatTime, formatRelativeChatTime } from "../../utils/formatRelativeChatTime";

type ConversationGroupItemProps = {
  groupId: string;
  groupName: string;
  rowCount: number;
  latestTimestampIso?: string;
  collapsed: boolean;
  /** Receives the group id so the parent can pass one stable callback for all groups. */
  onToggle: (groupId: string) => void;
  children: ReactNode;
};

function ConversationGroupItemImpl({
  groupId,
  groupName,
  rowCount,
  latestTimestampIso,
  collapsed,
  onToggle,
  children,
}: ConversationGroupItemProps) {
  const stamp = formatRelativeChatTime(latestTimestampIso);
  const stampExact = formatExactChatTime(latestTimestampIso);

  return (
    <div className="pt-1">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
        onClick={() => onToggle(groupId)}
      >
        <span className="min-w-0 flex flex-1 items-center gap-1.5 text-left">
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="block truncate font-semibold uppercase text-foreground/90">{groupName}</span>
            </span>
            {stamp ? (
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={stampExact}>
                {stamp}
              </span>
            ) : null}
          </span>
        </span>
        <span className="ml-2 shrink-0 self-start pt-0.5 text-[10px] text-muted-foreground">{rowCount}</span>
      </button>
      {collapsed ? null : <div className="mt-0.5 flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}

export const ConversationGroupItem = memo(ConversationGroupItemImpl);
