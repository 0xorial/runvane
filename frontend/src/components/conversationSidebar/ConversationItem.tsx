import { useEffect, useState } from "react";
import { MessageSquare, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { subscribeGlobalLive } from "../../protocol/runLiveClient";
import { SseType } from "../../protocol/sseTypes";
import {
  formatExactChatTime,
  formatRelativeChatTime,
} from "../../utils/formatRelativeChatTime";
import { LlmMetaBadge } from "../chat/LlmMetaBadge";
import { NewGroupDialog } from "./NewGroupDialog";
import type { ConversationGroupRow, ConversationRow } from "./types";

type ConversationItemProps = {
  conversation: ConversationRow;
  active: boolean;
  nested?: boolean;
  knownGroups: ConversationGroupRow[];
  multiSelectMode: boolean;
  deletedMode: boolean;
  selected: boolean;
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

export function ConversationItem({
  conversation,
  active,
  nested = false,
  knownGroups,
  multiSelectMode,
  deletedMode,
  selected,
  onSelect,
  onToggleSelected,
  onRenameConversation,
  onMoveConversationToGroup,
  onSoftDeleteConversation,
  onUndeleteConversation,
  onPermanentlyDeleteConversation,
}: ConversationItemProps) {
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [streamedTitle, setStreamedTitle] = useState("");
  const timestampIso = conversation.updated_at || conversation.created_at;
  const stamp = formatRelativeChatTime(timestampIso);
  const stampExact = formatExactChatTime(timestampIso);
  const promptTokens = Number(conversation.prompt_tokens_total ?? 0);
  const cachedPromptTokens = Number(conversation.cached_prompt_tokens_total ?? 0);
  const completionTokens = Number(conversation.completion_tokens_total ?? 0);
  const estimatedCostUsd = Number(conversation.estimated_cost_usd ?? 0);

  async function submitNewGroupDialog() {
    const groupName = newGroupName.trim();
    if (!groupName) return;
    await onMoveConversationToGroup(conversation, { newGroupName: groupName });
    setMoveDialogOpen(false);
    setNewGroupName("");
  }

  useEffect(() => {
    const dispose = subscribeGlobalLive({
      onSseEvent: (ev) => {
        if (ev.type === SseType.TITLE_STARTING && ev.conversation_id === conversation.id) {
          setStreamedTitle("");
          return;
        }
        if (ev.type === SseType.TITLE_LLM_STREAM && ev.conversation_id === conversation.id) {
          setStreamedTitle((prev) => `${prev}${ev.delta}`);
          return;
        }
        if (ev.type === SseType.CONVERSATION_UPDATED && ev.conversation.id === conversation.id) {
          setStreamedTitle("");
        }
      },
    });
    return () => dispose();
  }, [conversation.id]);

  return (
    <>
      <div
        className={cn(
          "group/row flex w-full shrink-0 items-stretch overflow-hidden rounded-md text-xs transition-colors",
          nested && "ml-3",
          active
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
        )}
      >
        <div className="flex w-6 shrink-0 items-center justify-center">
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onToggleSelected(conversation.id, checked === true)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select conversation ${conversation.title || conversation.id}`}
            className={cn(
              "h-4 w-4 transition-opacity",
              multiSelectMode ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
            )}
          />
        </div>
        <button
          type="button"
          className="min-w-0 flex-1 py-2 pl-0.5 pr-2.5 text-left"
          onClick={() => {
            if (multiSelectMode) {
              onToggleSelected(conversation.id, !selected);
              return;
            }
            onSelect(conversation.id);
          }}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate font-medium text-foreground/90 group-hover/row:text-foreground">
              {streamedTitle || conversation.title || "Untitled"}
            </span>
          </div>
          {stamp ? (
            <span
              className="ml-5.5 mt-0.5 block truncate text-[10px] text-muted-foreground"
              title={stampExact}
            >
              {stamp}
            </span>
          ) : null}
          <LlmMetaBadge
            promptTokens={promptTokens}
            cachedPromptTokens={cachedPromptTokens}
            completionTokens={completionTokens}
            showTokenBreakdown
            estimatedCostUsd={estimatedCostUsd}
            className="ml-5.5 mt-0.5 bg-transparent px-0 py-0 text-[10px]"
          />
        </button>
        {multiSelectMode ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "h-auto w-7 shrink-0 rounded-none shadow-none",
                  "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                  "opacity-60 group-hover/row:opacity-100",
                  active && "text-foreground opacity-100",
                )}
                aria-label="Chat menu"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {deletedMode || conversation.is_deleted ? (
                <>
                  <DropdownMenuItem onSelect={() => void onUndeleteConversation(conversation)}>
                    Undelete
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void onPermanentlyDeleteConversation(conversation)}>
                    Delete permanently
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem onSelect={() => void onRenameConversation(conversation)}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Move to group</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-52">
                      <DropdownMenuItem
                        onSelect={() => void onMoveConversationToGroup(conversation, { groupId: null })}
                      >
                        No group
                      </DropdownMenuItem>
                      {knownGroups.map((group) => (
                        <DropdownMenuItem
                          key={group.id}
                          onSelect={() =>
                            void onMoveConversationToGroup(conversation, { groupId: group.id })
                          }
                        >
                          {group.name}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuItem onSelect={() => setMoveDialogOpen(true)}>
                        New group...
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem onSelect={() => void onSoftDeleteConversation(conversation)}>
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <NewGroupDialog
        conversationId={conversation.id}
        open={moveDialogOpen}
        newGroupName={newGroupName}
        onOpenChange={(open) => {
          setMoveDialogOpen(open);
          if (!open) setNewGroupName("");
        }}
        onNewGroupNameChange={setNewGroupName}
        onSubmit={submitNewGroupDialog}
      />
    </>
  );
}
