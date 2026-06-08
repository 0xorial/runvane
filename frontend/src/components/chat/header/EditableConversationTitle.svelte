<script lang="ts">
  let {
    title,
    disabled = false,
    onCommit,
  }: {
    title: string;
    disabled?: boolean;
    onCommit: (nextTitle: string) => Promise<void>;
  } = $props();

  let editing = $state(false);
  let value = $state("");
  let busy = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!editing) value = title;
  });

  $effect(() => {
    if (!editing || !inputEl) return;
    const id = window.setTimeout(() => {
      inputEl?.focus();
      inputEl?.select();
    }, 0);
    return () => window.clearTimeout(id);
  });

  async function commit(): Promise<void> {
    const next = value.trim();
    if (!next || next === title.trim()) {
      editing = false;
      value = title;
      return;
    }
    busy = true;
    try {
      await onCommit(next);
      editing = false;
    } finally {
      busy = false;
    }
  }
</script>

{#if editing && !disabled}
  <input
    bind:this={inputEl}
    data-testid="conversation-title"
    class="h-7 max-w-[460px] rounded-md border border-input bg-background px-2 text-sm font-medium"
    maxlength={120}
    {value}
    disabled={busy}
    aria-label="Conversation title"
    oninput={(e) => (value = e.currentTarget.value)}
    onblur={() => void commit()}
    onkeydown={(e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        editing = false;
        value = title;
      }
    }}
  />
{:else}
  <button
    type="button"
    data-testid="conversation-title"
    class="truncate rounded-md px-1 py-0.5 text-left text-sm font-medium text-foreground hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
    {disabled}
    title={disabled ? title : "Click to rename conversation"}
    onclick={() => {
      if (!disabled) editing = true;
    }}
  >
    {title}
  </button>
{/if}
