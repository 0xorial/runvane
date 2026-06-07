import { memo } from "react";
import type { ModelPricing } from "@/lib/costEstimation";
import { ConversationItem } from "./ConversationItem";
import type { ConversationGroupRow, ConversationRow } from "./types";

export type ConversationRowHandlers = {
  onSelect: (id: string) => void;
  onToggleSelected: (id: string, checked: boolean) => void;
  onRenameConversation: (conversation: ConversationRow) => Promise<void>;
  onMoveConversationToGroup: (
    conversation: ConversationRow,
    target: { groupId?: string | null; newGroupName?: string },
  ) => Promise<void>;
  onSoftDeleteConversation: (conversation: ConversationRow) => Promise<void>;
  onUndeleteConversation: (conversation: ConversationRow) => Promise<void>;
  onPermanentlyDeleteConversation: (conversation: ConversationRow) => Promise<void>;
};

type ConversationRowListProps = {
  rows: ConversationRow[];
  nested?: boolean;
  knownGroups: ConversationGroupRow[];
  multiSelectMode: boolean;
  deletedMode: boolean;
  pricingByModel: Map<string, ModelPricing>;
  selectedConversationIds: string[];
} & ConversationRowHandlers;

function ConversationRowListImpl({
  rows,
  nested = false,
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
}: ConversationRowListProps) {
  const selected = new Set(selectedConversationIds);
  return (
    <>
      {rows.map((conversation) => (
        <ConversationItem
          key={conversation.id}
          conversation={conversation}
          nested={nested}
          knownGroups={knownGroups}
          multiSelectMode={multiSelectMode}
          deletedMode={deletedMode}
          pricingByModel={pricingByModel}
          selected={selected.has(conversation.id)}
          onSelect={onSelect}
          onToggleSelected={onToggleSelected}
          onRenameConversation={onRenameConversation}
          onMoveConversationToGroup={onMoveConversationToGroup}
          onSoftDeleteConversation={onSoftDeleteConversation}
          onUndeleteConversation={onUndeleteConversation}
          onPermanentlyDeleteConversation={onPermanentlyDeleteConversation}
        />
      ))}
    </>
  );
}

export const ConversationRowList = memo(ConversationRowListImpl);
