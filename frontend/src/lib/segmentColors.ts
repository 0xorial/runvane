/**
 * Active-state colours for policy-style segmented controls (chat-sidebar tool
 * overrides and the agent editor share these for visual parity). One semantic
 * scheme: green = enabled, sky = conditional/deferred, dimmed neutral = off,
 * violet = custom rules.
 */
export const SEGMENT_ACTIVE_CLASS = {
  /** Off / Never — clearly filled so the selected state reads at a glance. */
  off: "bg-muted-foreground/25 font-semibold text-foreground",
  /** Ask / Per-tool — conditional, resolved case by case. */
  conditional: "bg-sky-500/25 font-semibold text-sky-800 dark:text-sky-200",
  /** Allow / Always — enabled without further prompts. */
  enabled: "bg-emerald-500/25 font-semibold text-emerald-800 dark:text-emerald-200",
  /** Custom — per-tool rules take over. */
  custom: "bg-violet-500/25 font-semibold text-violet-800 dark:text-violet-200",
} as const;
