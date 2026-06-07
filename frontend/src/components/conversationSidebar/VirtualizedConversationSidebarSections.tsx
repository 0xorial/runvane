import { memo, useLayoutEffect, useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ConversationGroupItem } from "./ConversationGroupItem";
import { ConversationItem } from "./ConversationItem";
import type { ConversationRowHandlers } from "./ConversationRowList";
import type { ConversationGroupRow } from "./types";
import type { ModelPricing } from "@/lib/costEstimation";
import type { SidebarSection } from "./ConversationSidebarSections";
import { CONVERSATION_SIDEBAR_LIST_ID } from "./SidebarSelectionHighlight";
import { flattenSidebarSections, virtualRowHeight } from "./virtualSidebarRows";

type VirtualizedConversationSidebarSectionsProps = {
  orderedSections: SidebarSection[];
  collapsedGroups: Record<string, boolean>;
  knownGroups: ConversationGroupRow[];
  multiSelectMode: boolean;
  deletedMode: boolean;
  pricingByModel: Map<string, ModelPricing>;
  selectedConversationIds: string[];
  onToggleGroup: (groupId: string) => void;
} & ConversationRowHandlers;

function VirtualizedConversationSidebarSectionsImpl({
  orderedSections,
  collapsedGroups,
  knownGroups,
  multiSelectMode,
  deletedMode,
  pricingByModel,
  selectedConversationIds,
  onSelect,
  onToggleSelected,
  onRenameConversation,
  onMoveConversationToGroup,
  onSoftDeleteConversation,
  onUndeleteConversation,
  onPermanentlyDeleteConversation,
  onToggleGroup,
}: VirtualizedConversationSidebarSectionsProps) {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setScrollElement(document.getElementById(CONVERSATION_SIDEBAR_LIST_ID));
  }, []);

  const virtualRows = useMemo(
    () => flattenSidebarSections(orderedSections, collapsedGroups),
    [orderedSections, collapsedGroups],
  );
  const selected = useMemo(() => new Set(selectedConversationIds), [selectedConversationIds]);

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => virtualRowHeight(virtualRows[index]),
    overscan: 12,
  });

  const conversationItemProps = {
    knownGroups,
    multiSelectMode,
    deletedMode,
    pricingByModel,
    onSelect,
    onToggleSelected,
    onRenameConversation,
    onMoveConversationToGroup,
    onSoftDeleteConversation,
    onUndeleteConversation,
    onPermanentlyDeleteConversation,
  };

  return (
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const item = virtualRows[virtualRow.index];
        return (
          <div
            key={virtualRow.key}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {item.kind === "group-header" ? (
              <ConversationGroupItem
                groupId={item.groupId}
                groupName={item.groupName}
                rowCount={item.rowCount}
                latestTimestampIso={item.latestTimestampIso}
                collapsed={item.collapsed}
                onToggle={onToggleGroup}
              >
                {null}
              </ConversationGroupItem>
            ) : (
              <ConversationItem
                conversation={item.row}
                nested={item.nested}
                selected={selected.has(item.row.id)}
                {...conversationItemProps}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export const VirtualizedConversationSidebarSections = memo(VirtualizedConversationSidebarSectionsImpl);
