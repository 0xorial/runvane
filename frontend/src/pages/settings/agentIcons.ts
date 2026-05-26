import type { LucideIcon } from "lucide-react";
import {
  Beaker,
  Bot,
  Brain,
  Code,
  Compass,
  Cog,
  Cpu,
  Database,
  FileText,
  Globe,
  Hammer,
  MessageSquare,
  Mic,
  Rocket,
  Search,
  Shield,
  Sparkles,
  Terminal,
  Wrench,
  Zap,
} from "lucide-react";

export type AgentIconDef = { id: string; label: string; Icon: LucideIcon };

export const AGENT_ICONS: AgentIconDef[] = [
  { id: "bot", label: "Bot", Icon: Bot },
  { id: "brain", label: "Brain", Icon: Brain },
  { id: "sparkles", label: "Sparkles", Icon: Sparkles },
  { id: "code", label: "Code", Icon: Code },
  { id: "terminal", label: "Terminal", Icon: Terminal },
  { id: "wrench", label: "Wrench", Icon: Wrench },
  { id: "hammer", label: "Hammer", Icon: Hammer },
  { id: "search", label: "Search", Icon: Search },
  { id: "globe", label: "Globe", Icon: Globe },
  { id: "file-text", label: "File", Icon: FileText },
  { id: "database", label: "Database", Icon: Database },
  { id: "cpu", label: "Cpu", Icon: Cpu },
  { id: "beaker", label: "Beaker", Icon: Beaker },
  { id: "shield", label: "Shield", Icon: Shield },
  { id: "compass", label: "Compass", Icon: Compass },
  { id: "message-square", label: "Chat", Icon: MessageSquare },
  { id: "zap", label: "Zap", Icon: Zap },
  { id: "mic", label: "Mic", Icon: Mic },
  { id: "cog", label: "Cog", Icon: Cog },
  { id: "rocket", label: "Rocket", Icon: Rocket },
];

const ICON_BY_ID = new Map(AGENT_ICONS.map((i) => [i.id, i] as const));

export function getAgentIcon(iconId: string | null | undefined): LucideIcon {
  if (!iconId) return Bot;
  return ICON_BY_ID.get(iconId)?.Icon ?? Bot;
}
