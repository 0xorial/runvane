import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type NewGroupDialogProps = {
  conversationId: string;
  open: boolean;
  newGroupName: string;
  onOpenChange: (open: boolean) => void;
  onNewGroupNameChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
};

export function NewGroupDialog({
  conversationId,
  open,
  newGroupName,
  onOpenChange,
  onNewGroupNameChange,
  onSubmit,
}: NewGroupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>Move this conversation to a new group.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`new-group-${conversationId}`}>
            Group name
          </label>
          <input
            id={`new-group-${conversationId}`}
            className="box-border min-h-[34px] w-full rounded-md border border-input bg-background px-3 text-sm"
            value={newGroupName}
            onChange={(e) => onNewGroupNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onSubmit();
              }
            }}
            placeholder="e.g. Work"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onSubmit()}>
            Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
