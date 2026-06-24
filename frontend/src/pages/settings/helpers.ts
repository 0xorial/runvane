import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
import type { ProviderRow } from "@/types/llmSettings";

export function sortAgents(list: AgentListItemResponse[] | null | undefined): AgentListItemResponse[] {
  return [...(list || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export const SETTINGS_SECTIONS = [
  "model-providers",
  "model-presets",
  "model-pricing",
  "agents",
  "tools",
  "skills",
  "rag",
  "tool-environments",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "model-providers";

export function parseSettingsSection(section: string | undefined): SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(section ?? "")
    ? (section as SettingsSection)
    : DEFAULT_SETTINGS_SECTION;
}

export function normalizeSearchToken(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function filterProviders(providers: ProviderRow[] | null | undefined, search: string): ProviderRow[] {
  const q = String(search || "")
    .trim()
    .toLowerCase();
  if (!q) return providers || [];
  const nq = normalizeSearchToken(q);
  return (providers || []).filter((p) => {
    return (
      String(p.label || "")
        .toLowerCase()
        .includes(q) ||
      String(p.id || "")
        .toLowerCase()
        .includes(q) ||
      normalizeSearchToken(p.label).includes(nq) ||
      normalizeSearchToken(p.id).includes(nq)
    );
  });
}

export type DropdownItem = string | { value: string; label: string; className?: string };
export type ModelGroup = { id: string; label: string; models: DropdownItem[] };

export function buildModelGroups(providers: ProviderRow[] | null | undefined): ModelGroup[] {
  if (!providers?.length) return [];
  const groups: ModelGroup[] = [];
  for (const p of providers) {
    if (!p.models_verified) continue;
    const id = String(p.id || "");
    if (!id) continue;
    const source = p.models;
    if (!source?.length) continue;
    const models = source.length === 1 ? source : source.slice().sort((a, b) => String(a).localeCompare(String(b)));
    groups.push({ id, label: String(p.label || id), models });
  }
  return groups;
}
