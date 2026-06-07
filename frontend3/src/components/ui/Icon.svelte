<script lang="ts">
  const STROKE = "currentColor";
  const DEFAULT = "h-3.5 w-3.5 shrink-0";

  let {
    name,
    class: className = DEFAULT,
    strokeWidth = 2,
  }: {
    name:
      | "x"
      | "trash"
      | "pencil"
      | "chevron-down"
      | "chevron-right"
      | "sun"
      | "moon"
      | "loader"
      | "activity"
      | "square"
      | "arrow-right"
      | "check-circle"
      | "x-circle";
    class?: string;
    strokeWidth?: number;
  } = $props();
</script>

<svg
  class={className}
  xmlns="http://www.w3.org/2000/svg"
  fill="none"
  viewBox="0 0 24 24"
  stroke={STROKE}
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "x"}
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  {:else if name === "trash"}
    <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  {:else if name === "pencil"}
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />
  {:else if name === "chevron-down"}
    <path d="m6 9 6 6 6-6" />
  {:else if name === "chevron-right"}
    <path d="m9 18 6-6-6-6" />
  {:else if name === "sun"}
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
  {:else if name === "moon"}
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  {:else if name === "loader"}
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  {:else if name === "activity"}
    <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
  {:else if name === "square"}
    <rect width="18" height="18" x="3" y="3" rx="2" />
  {:else if name === "arrow-right"}
    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
  {:else if name === "check-circle"}
    <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
  {:else if name === "x-circle"}
    <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />
  {/if}
</svg>
