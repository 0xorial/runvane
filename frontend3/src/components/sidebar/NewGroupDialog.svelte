<script lang="ts">
  import TextInputDialog from "./TextInputDialog.svelte";

  let {
    open,
    newGroupName,
    onOpenChange,
    onNewGroupNameChange,
    onSubmit,
  }: {
    open: boolean;
    newGroupName: string;
    onOpenChange: (open: boolean) => void;
    onNewGroupNameChange: (name: string) => void;
    onSubmit: () => void | Promise<void>;
  } = $props();
</script>

<TextInputDialog
  {open}
  title="New group"
  value={newGroupName}
  placeholder="Group name"
  submitLabel="Create"
  onOpenChange={onOpenChange}
  onValueChange={onNewGroupNameChange}
  {onSubmit}
/>
