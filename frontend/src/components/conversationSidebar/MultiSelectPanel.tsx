import { Trash2, X } from "lucide-react";
import type { ConversationGroupRow } from "./types";
import { MoveSelectedToGroupControl } from "./MoveSelectedToGroupControl";

type MultiSelectPanelProps = {
  selectedConversationIds: string[];
  knownGroups: ConversationGroupRow[];
  reloadConversations: () => Promise<{ groups: ConversationGroupRow[] }>;
  onSelectionChange: (ids: string[]) => void;
  onExpandGroup: (groupId: string) => void;
};

export function MultiSelectPanel({
  selectedConversationIds,
  knownGroups,
  reloadConversations,
  onSelectionChange,
  onExpandGroup,
}: MultiSelectPanelProps) {
  return (
    <div className="flex items-center justify-between border-t border-sidebar-border pt-1 text-xs text-muted-foreground">
      <span>{selectedConversationIds.length} selected</span>
      <div className="flex items-center gap-0.5">
        <MoveSelectedToGroupControl
          selectedConversationIds={selectedConversationIds}
          knownGroups={knownGroups}
          reloadConversations={reloadConversations}
          onSelectionChange={onSelectionChange}
          onExpandGroup={onExpandGroup}
        />
        <button
          type="button"
          aria-label="Delete selected conversations"
          title="Delete selected conversations (coming soon)"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-destructive/70"
          disabled
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Exit multi-select mode"
          title="Exit multi-select mode"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
          onClick={() => onSelectionChange([])}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
