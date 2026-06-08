export type AgentIconDef = { id: string; label: string };

export const AGENT_ICONS: AgentIconDef[] = [
  { id: "bot", label: "Bot" },
  { id: "brain", label: "Brain" },
  { id: "sparkles", label: "Sparkles" },
  { id: "code", label: "Code" },
  { id: "terminal", label: "Terminal" },
  { id: "wrench", label: "Wrench" },
  { id: "hammer", label: "Hammer" },
  { id: "search", label: "Search" },
  { id: "globe", label: "Globe" },
  { id: "file-text", label: "File" },
  { id: "database", label: "Database" },
  { id: "cpu", label: "Cpu" },
  { id: "beaker", label: "Beaker" },
  { id: "shield", label: "Shield" },
  { id: "compass", label: "Compass" },
  { id: "message-square", label: "Chat" },
  { id: "zap", label: "Zap" },
  { id: "mic", label: "Mic" },
  { id: "cog", label: "Cog" },
  { id: "rocket", label: "Rocket" },
];

export const DEFAULT_AGENT_ICON_ID = AGENT_ICONS[0].id;

const ICON_BY_ID = new Set(AGENT_ICONS.map((i) => i.id));

export function resolveAgentIconId(iconId: string | null | undefined): string {
  if (!iconId || !ICON_BY_ID.has(iconId)) return DEFAULT_AGENT_ICON_ID;
  return iconId;
}

export function getAgentIconDef(iconId: string | null | undefined): AgentIconDef {
  const id = resolveAgentIconId(iconId);
  return AGENT_ICONS.find((icon) => icon.id === id) ?? AGENT_ICONS[0];
}
