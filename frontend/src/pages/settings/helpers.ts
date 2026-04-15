import type { AgentListItemResponse } from "../../../../backend/src/routes/agents.types";
import type { ProviderRow } from "../../types/llmSettings";

export function sortAgents(list: AgentListItemResponse[] | null | undefined): AgentListItemResponse[] {
  return [...(list || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function normalizeSection(section: string | undefined): string {
  const s = (section || "").toLowerCase();
  if (s === "model-providers" || s === "model_provider" || s === "providers") {
    return "model_provider";
  }
  if (s === "model-presets" || s === "model_presets" || s === "presets") {
    return "model_presets";
  }
  if (s === "tools") return "tools";
  if (s === "skills") return "skills";
  if (s === "agents") return "agents";
  return "model_provider";
}

export function normalizeSearchToken(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export type DropdownItem = string | { value: string; label: string };
export type ModelGroup = { id: string; label: string; models: DropdownItem[] };

export function buildModelGroups(providers: ProviderRow[] | null | undefined): ModelGroup[] {
  return (providers || [])
    .map((p) => ({
      id: String(p.id || ""),
      label: String(p.label || p.id || ""),
      models: [...(p.models_verified ? p.models || [] : [])].sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
      ),
    }))
    .filter((g) => g.id && g.models.length > 0);
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
