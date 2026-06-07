export type AgentIconDef = { id: string; label: string; glyph: string };

export const AGENT_ICONS: AgentIconDef[] = [
  { id: "bot", label: "Bot", glyph: "🤖" },
  { id: "brain", label: "Brain", glyph: "🧠" },
  { id: "sparkles", label: "Sparkles", glyph: "✨" },
  { id: "code", label: "Code", glyph: "💻" },
  { id: "terminal", label: "Terminal", glyph: "⌨️" },
  { id: "wrench", label: "Wrench", glyph: "🔧" },
  { id: "hammer", label: "Hammer", glyph: "🔨" },
  { id: "search", label: "Search", glyph: "🔍" },
  { id: "globe", label: "Globe", glyph: "🌐" },
  { id: "file-text", label: "File", glyph: "📄" },
  { id: "database", label: "Database", glyph: "🗄️" },
  { id: "cpu", label: "Cpu", glyph: "⚙️" },
  { id: "beaker", label: "Beaker", glyph: "🧪" },
  { id: "shield", label: "Shield", glyph: "🛡️" },
  { id: "compass", label: "Compass", glyph: "🧭" },
  { id: "message-square", label: "Chat", glyph: "💬" },
  { id: "zap", label: "Zap", glyph: "⚡" },
  { id: "mic", label: "Mic", glyph: "🎤" },
  { id: "cog", label: "Cog", glyph: "⚙️" },
  { id: "rocket", label: "Rocket", glyph: "🚀" },
];

const ICON_BY_ID = new Map(AGENT_ICONS.map((i) => [i.id, i] as const));

export function getAgentIconGlyph(iconId: string | null | undefined): string {
  if (!iconId) return "🤖";
  return ICON_BY_ID.get(iconId)?.glyph ?? "🤖";
}

export function getAgentIconDef(iconId: string | null | undefined): AgentIconDef {
  if (!iconId) return AGENT_ICONS[0];
  return ICON_BY_ID.get(iconId) ?? AGENT_ICONS[0];
}
