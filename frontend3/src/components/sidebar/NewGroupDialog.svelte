<script lang="ts">
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

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg">
      <h2 class="mb-3 text-sm font-medium">New group</h2>
      <input
        class="mb-3 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        placeholder="Group name"
        value={newGroupName}
        oninput={(e) => onNewGroupNameChange(e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === "Enter") void onSubmit();
          if (e.key === "Escape") onOpenChange(false);
        }}
      />
      <div class="flex justify-end gap-2">
        <button type="button" class="rounded-md px-2 py-1 text-xs text-muted-foreground" onclick={() => onOpenChange(false)}>
          Cancel
        </button>
        <button
          type="button"
          class="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground"
          onclick={() => void onSubmit()}
        >
          Create
        </button>
      </div>
    </div>
  </div>
{/if}
