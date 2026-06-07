import { memo } from "react";
import { ConversationGroupItem } from "./ConversationGroupItem";
import { ConversationRowList, type ConversationRowHandlers } from "./ConversationRowList";
import type { ConversationGroupRow, ConversationRow } from "./types";
import type { ModelPricing } from "@/lib/costEstimation";

export type SidebarSection =
  | { kind: "conversation"; row: ConversationRow; latestMs: number }
  | {
      kind: "group";
      groupId: string;
      groupName: string;
      rows: ConversationRow[];
      latestMs: number;
      latestTimestampIso: string;
    };

type ConversationSidebarSectionsProps = {
  orderedSections: SidebarSection[];
  collapsedGroups: Record<string, boolean>;
  knownGroups: ConversationGroupRow[];
  multiSelectMode: boolean;
  deletedMode: boolean;
  pricingByModel: Map<string, ModelPricing>;
  selectedConversationIds: string[];
  onToggleGroup: (groupId: string) => void;
} & ConversationRowHandlers;

function ConversationSidebarSectionsImpl({
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
}: ConversationSidebarSectionsProps) {
  const rowListSharedProps = {
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
  };

  return (
    <>
      {orderedSections.map((section) => {
        if (section.kind === "conversation") {
          return <ConversationRowList key={section.row.id} rows={[section.row]} {...rowListSharedProps} />;
        }
        const collapsed = collapsedGroups[section.groupId] ?? false;
        return (
          <ConversationGroupItem
            key={section.groupId}
            groupId={section.groupId}
            groupName={section.groupName}
            rowCount={section.rows.length}
            latestTimestampIso={section.latestTimestampIso}
            collapsed={collapsed}
            onToggle={onToggleGroup}
          >
            <ConversationRowList rows={section.rows} nested {...rowListSharedProps} />
          </ConversationGroupItem>
        );
      })}
    </>
  );
}

export const ConversationSidebarSections = memo(ConversationSidebarSectionsImpl);
