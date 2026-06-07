<script lang="ts">
  import { notifyError } from "@/utils/toast";

  let {
    value,
    title = "Copy",
    class: className = "",
  }: {
    value: string;
    title?: string;
    class?: string;
  } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function onCopy(): Promise<void> {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch (e) {
      notifyError(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    copied = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      copied = false;
    }, 1500);
  }
</script>

<button
  type="button"
  onclick={() => void onCopy()}
  title={copied ? "Copied" : title}
  aria-label={copied ? "Copied" : title}
  class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground {className}"
>
  {#if copied}
    <svg class="h-3 w-3 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  {:else}
    <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  {/if}
</button>
