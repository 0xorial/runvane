<script lang="ts">
  let {
    open,
    title,
    value,
    placeholder = "",
    submitLabel = "Save",
    onOpenChange,
    onValueChange,
    onSubmit,
  }: {
    open: boolean;
    title: string;
    value: string;
    placeholder?: string;
    submitLabel?: string;
    onOpenChange: (open: boolean) => void;
    onValueChange: (value: string) => void;
    onSubmit: () => void | Promise<void>;
  } = $props();
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="text-input-dialog-title"
      class="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg"
    >
      <h2 id="text-input-dialog-title" class="mb-3 text-sm font-medium">{title}</h2>
      <input
        class="mb-3 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        {placeholder}
        {value}
        oninput={(e) => onValueChange(e.currentTarget.value)}
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
          {submitLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
