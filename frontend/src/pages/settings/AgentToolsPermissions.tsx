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
import styles from "./AgentToolsPermissions.module.css";

type ToolCatalogRow = { name?: unknown; description?: unknown };

type AgentToolsPermissionsProps = {
  agentEditId: string;
  canEditAgent: boolean;
  toolCatalog: Record<string, unknown>[];
  agentJson: string;
  setAgentJson: (s: string) => void;
};

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
      <div className={styles.invalidJson}>
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
    <div className={styles.agentToolsPermissions}>
      <div className={styles.agentToolsPermissionsTitle}>
        Tools &amp; permissions
      </div>
      <table className={styles.agentToolsTable}>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Description</th>
            <th>
              <label className={styles.agentToolsSelectAll}>
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
                <td className={styles.agentToolsDesc}>
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
