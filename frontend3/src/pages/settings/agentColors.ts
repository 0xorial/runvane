export type AgentColorDef = {
  id: string;
  label: string;
  wrap: string;
  swatch: string;
};

export const AGENT_COLORS: AgentColorDef[] = [
  { id: "slate", label: "Slate", wrap: "bg-slate-500/15 text-slate-600 dark:text-slate-300", swatch: "bg-slate-500" },
  { id: "red", label: "Red", wrap: "bg-red-500/15 text-red-600 dark:text-red-400", swatch: "bg-red-500" },
  { id: "orange", label: "Orange", wrap: "bg-orange-500/15 text-orange-600 dark:text-orange-400", swatch: "bg-orange-500" },
  { id: "amber", label: "Amber", wrap: "bg-amber-500/15 text-amber-600 dark:text-amber-400", swatch: "bg-amber-500" },
  { id: "green", label: "Green", wrap: "bg-green-500/15 text-green-600 dark:text-green-400", swatch: "bg-green-500" },
  { id: "teal", label: "Teal", wrap: "bg-teal-500/15 text-teal-600 dark:text-teal-400", swatch: "bg-teal-500" },
  { id: "sky", label: "Sky", wrap: "bg-sky-500/15 text-sky-600 dark:text-sky-400", swatch: "bg-sky-500" },
  { id: "blue", label: "Blue", wrap: "bg-blue-500/15 text-blue-600 dark:text-blue-400", swatch: "bg-blue-500" },
  { id: "indigo", label: "Indigo", wrap: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400", swatch: "bg-indigo-500" },
  { id: "violet", label: "Violet", wrap: "bg-violet-500/15 text-violet-600 dark:text-violet-400", swatch: "bg-violet-500" },
  { id: "pink", label: "Pink", wrap: "bg-pink-500/15 text-pink-600 dark:text-pink-400", swatch: "bg-pink-500" },
];

const DEFAULT_COLOR: AgentColorDef = {
  id: "default",
  label: "Default",
  wrap: "bg-muted text-muted-foreground",
  swatch: "bg-muted-foreground/40",
};

const BY_ID = new Map(AGENT_COLORS.map((c) => [c.id, c] as const));

export function getAgentColor(colorId: string | null | undefined): AgentColorDef {
  if (!colorId) return DEFAULT_COLOR;
  return BY_ID.get(colorId) ?? DEFAULT_COLOR;
}

export { DEFAULT_COLOR as AGENT_COLOR_DEFAULT };
