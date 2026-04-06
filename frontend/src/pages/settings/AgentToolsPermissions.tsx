import { useEffect, useRef } from "react";
import {
  getToolPermissionMode,
  isToolEnabled,
  setAllToolsEnabled,
  setToolEnabled,
  setToolPermissionMode,
  tryParseAgentJson,
} from "./agentToolsPolicy";
import type { MutableAgent } from "./agentToolsPolicy";

type ToolCatalogRow = { name?: unknown; description?: unknown };

type AgentToolsPermissionsProps = {
  agentEditId: string;
  canEditAgent: boolean;
  toolCatalog: Record<string, unknown>[];
  agentJson: string;
  setAgentJson: (s: string) => void;
};

const tableBase =
  "w-full border-collapse overflow-hidden rounded-[10px] border border-border text-[13px] [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-top [&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:font-bold [&_th]:text-muted-foreground";

export function AgentToolsPermissions({
  agentEditId,
  canEditAgent,
  toolCatalog,
  agentJson,
  setAgentJson,
}: AgentToolsPermissionsProps) {
  const rows = (toolCatalog || [])
    .slice()
    .sort((a, b) =>
      String((a as ToolCatalogRow).name).localeCompare(
        String((b as ToolCatalogRow).name),
      ),
    );
  const catalogNames = rows
    .map((t) => String((t as ToolCatalogRow).name || ""))
    .filter(Boolean);
  const agent = tryParseAgentJson(agentJson);
  const enabledCount = agent
    ? catalogNames.filter((n) => isToolEnabled(agent, n)).length
    : 0;
  const allToolsEnabled =
    catalogNames.length > 0 && enabledCount === catalogNames.length;
  const someToolsEnabled =
    enabledCount > 0 && enabledCount < catalogNames.length;
  const headerEnabledRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = headerEnabledRef.current;
    if (!el) return;
    el.indeterminate = someToolsEnabled;
  }, [someToolsEnabled]);

  if (!agent) {
    return (
      <div className="mb-3 text-[13px] text-amber-800 dark:text-amber-400">
        Invalid agent JSON — fix syntax to edit tools and permissions here.
      </div>
    );
  }

  const ag: MutableAgent = agent;

  function commit(nextAgent: MutableAgent) {
    nextAgent.id = String(agentEditId ?? nextAgent.id ?? "");
    setAgentJson(JSON.stringify(nextAgent, null, 2));
  }

  function onToggleEnabled(toolName: string, enabled: boolean) {
    if (!canEditAgent) return;
    const next = structuredClone(ag);
    setToolEnabled(next, toolName, enabled);
    commit(next);
  }

  function onPermissionChange(toolName: string, mode: string) {
    if (!canEditAgent) return;
    const next = structuredClone(ag);
    setToolPermissionMode(next, toolName, mode);
    commit(next);
  }

  function onToggleAllEnabled() {
    if (!canEditAgent) return;
    const next = structuredClone(ag);
    setAllToolsEnabled(next, catalogNames, !allToolsEnabled);
    commit(next);
  }

  return (
    <div className="relative z-[1] mb-4 text-foreground">
      <div className="mb-1.5 text-sm font-extrabold">Tools &amp; permissions</div>
      <table className={tableBase}>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Description</th>
            <th>
              <label className="m-0 inline-flex cursor-pointer items-center gap-2 font-inherit text-inherit">
                <input
                  ref={headerEnabledRef}
                  type="checkbox"
                  checked={allToolsEnabled}
                  disabled={catalogNames.length === 0 || !canEditAgent}
                  onChange={onToggleAllEnabled}
                  aria-label={
                    allToolsEnabled ? "Disable all tools" : "Enable all tools"
                  }
                />
                <span>Enabled</span>
              </label>
            </th>
            <th>Permission</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((raw) => {
            const t = raw as ToolCatalogRow;
            const name = String(t.name || "");
            if (!name) return null;
            const enabled = isToolEnabled(ag, name);
            const perm = getToolPermissionMode(ag, name);
            return (
              <tr key={name}>
                <td>
                  <code>{name}</code>
                </td>
                <td className="max-w-[360px] text-muted-foreground">
                  {t.description != null ? String(t.description) : "—"}
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={!canEditAgent}
                    onChange={(e) => onToggleEnabled(name, e.target.checked)}
                  />
                </td>
                <td>
                  <select
                    value={perm}
                    disabled={!canEditAgent}
                    onChange={(e) => onPermissionChange(name, e.target.value)}
                  >
                    <option value="allow_all">Allow all</option>
                    <option value="ask_every_time">Ask every time</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
