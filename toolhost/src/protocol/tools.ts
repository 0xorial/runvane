/**
 * Tool partition. Every tool in the system runs in exactly one place, and that
 * placement is fixed (not per-call). This is the line the harness routes on and
 * the bit the UI surfaces so a user can see where a call executed.
 */

export type ToolLocation = 'harness' | 'target';

/**
 * UI hints per location — `accent` and `icon` are framework-neutral tokens the
 * frontend maps to its own palette / icon set (icon names follow Tabler).
 */
export const TOOL_LOCATION_META: Record<ToolLocation, { label: string; accent: string; icon: string }> = {
  harness: { label: 'harness', accent: 'purple', icon: 'cpu' },
  target: { label: 'target', accent: 'teal', icon: 'terminal-2' },
};

/**
 * Default placement for known runvane tools. Anything touching central state
 * (rag indexes, conversation history, backend introspection) stays in the
 * harness sandbox; anything touching the target sandbox's files/processes runs
 * in the host. Unknown tools default to `harness` (safe: nothing crosses the
 * wire unasked).
 */
export const DEFAULT_TOOL_LOCATIONS: Record<string, ToolLocation> = {
  exec: 'target',
  filesystem: 'target',
  filesystem_index: 'target',
  rag: 'harness',
  conversations: 'harness',
  api: 'harness',
};

export function locationOf(toolName: string): ToolLocation {
  return DEFAULT_TOOL_LOCATIONS[toolName] ?? 'harness';
}
