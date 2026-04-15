import { useState } from "react";
import { FolderInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { renameConversation } from "../../api/client";
import { notifyError } from "../../utils/toast";
import type { ConversationGroupRow } from "./types";

type MoveSelectedToGroupControlProps = {
  selectedConversationIds: string[];
  knownGroups: ConversationGroupRow[];
  reloadConversations: () => Promise<{ groups: ConversationGroupRow[] }>;
  onSelectionChange: (ids: string[]) => void;
  onExpandGroup: (groupId: string) => void;
};

export function MoveSelectedToGroupControl({
  selectedConversationIds,
  knownGroups,
  reloadConversations,
  onSelectionChange,
  onExpandGroup,
}: MoveSelectedToGroupControlProps) {
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  async function moveSelected(target: { groupId?: string | null; newGroupName?: string }) {
    try {
      if (selectedConversationIds.length === 0) return;
      const requestBody = {
        group_id: Object.prototype.hasOwnProperty.call(target, "groupId") ? (target.groupId ?? null) : undefined,
        new_group_name: Object.prototype.hasOwnProperty.call(target, "newGroupName")
          ? String(target.newGroupName ?? "")
          : undefined,
      };

      const results = await Promise.allSettled(
        selectedConversationIds.map((conversationId) => renameConversation(conversationId, requestBody)),
      );
      const failedIds: string[] = [];
      let firstReason = "";
      results.forEach((result, index) => {
        if (result.status === "fulfilled") return;
        failedIds.push(selectedConversationIds[index]);
        if (!firstReason) {
          firstReason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        }
      });

      const data = await reloadConversations();
      if (failedIds.length > 0) {
        onSelectionChange(failedIds);
        notifyError(
          `Moved ${selectedConversationIds.length - failedIds.length}/${selectedConversationIds.length}. ${firstReason}`,
        );
        return;
      }

      onSelectionChange([]);
      const targetGroupId = target.groupId;
      if (typeof targetGroupId === "string" && targetGroupId.trim()) {
        onExpandGroup(targetGroupId);
        return;
      }
      if (target.newGroupName) {
        const nextGroup = data.groups.find(
          (group) =>
            group.name.localeCompare(target.newGroupName || "", undefined, {
              sensitivity: "base",
            }) === 0,
        );
        if (nextGroup?.id) onExpandGroup(nextGroup.id);
      }
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitNewGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    await moveSelected({ newGroupName: name });
    setMoveDialogOpen(false);
    setNewGroupName("");
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Move selected conversations"
            title="Move selected conversations"
            className="h-6 w-6 text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
          >
            <FolderInput className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => void moveSelected({ groupId: null })}>No group</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to group</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              {knownGroups.map((group) => (
                <DropdownMenuItem key={group.id} onSelect={() => void moveSelected({ groupId: group.id })}>
                  {group.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => setMoveDialogOpen(true)}>New group...</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={moveDialogOpen}
        onOpenChange={(open) => {
          setMoveDialogOpen(open);
          if (!open) setNewGroupName("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>Move selected conversations to a new group.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="new-group-multiselect">
              Group name
            </label>
            <input
              id="new-group-multiselect"
              className="box-border min-h-[34px] w-full rounded-md border border-input bg-background px-3 text-sm"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void submitNewGroup();
              }}
              placeholder="e.g. Work"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMoveDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitNewGroup()}>
              Create group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
