import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
import { getAgents } from "../../api/client";
import { getAgentIcon } from "../../pages/settings/agentIcons";
import { getAgentColor } from "../../pages/settings/agentColors";
import { getAgentLlm } from "../../pages/settings/agentLlm";
import { sortAgents } from "../../pages/settings/helpers";
import { cn } from "@/lib/utils";

type AgentCardsEmptyStateProps = {
  selectedAgentId: string;
};

export function AgentCardsEmptyState({ selectedAgentId }: AgentCardsEmptyStateProps) {
  const [agents, setAgents] = useState<AgentListItemResponse[] | null>(null);
  const [, setUrlParams] = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    getAgents().then(
      (rows) => {
        if (!cancelled) setAgents(rows);
      },
      () => {
        if (!cancelled) setAgents([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (agents == null) return null;
  const sorted = sortAgents(agents);
  if (sorted.length === 0) return null;

  function enabledToolIds(agent: AgentListItemResponse): string[] {
    const tools = agent.default_llm_configuration?.tools;
    if (!tools) return [];
    return Object.entries(tools)
      .filter(([, cfg]) => cfg?.enabled !== false)
      .map(([id]) => id)
      .sort((a, b) => a.localeCompare(b));
  }

  return (
    <div className="flex h-full w-full items-center justify-center px-4 py-8">
      <div className="grid w-full max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((agent) => {
          const Icon = getAgentIcon(agent.icon);
          const color = getAgentColor(agent.color);
          const llm = getAgentLlm(agent);
          const model = llm.model.trim();
          const selected = selectedAgentId === agent.id;
          const selectAgent = () =>
            setUrlParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set("agent", agent.id);
                return next;
              },
              { replace: true },
            );
          return (
            <div
              key={agent.id}
              role="button"
              tabIndex={0}
              onClick={selectAgent}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectAgent();
                }
              }}
              className={cn(
                "group relative flex min-h-[88px] cursor-pointer items-start gap-3 rounded-xl border border-border bg-card/40 p-3 text-left transition-colors hover:border-primary/60 hover:bg-card",
                selected && "border-primary/70 bg-primary/5",
              )}
            >
              <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", color.wrap)}>
                <Icon className="h-4.5 w-4.5" strokeWidth={1.85} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate pr-6 text-sm font-medium text-foreground">
                  {agent.name.trim() || "Untitled agent"}
                  {agent.is_default ? (
                    <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">default</span>
                  ) : null}
                </span>
                {model ? (
                  <span className="mt-0.5 block break-all font-mono text-[11px] leading-snug text-muted-foreground">
                    {model}
                  </span>
                ) : null}
                <AgentCardTools toolIds={enabledToolIds(agent)} />
              </span>
              <Link
                to={`/settings/agents?agent=${encodeURIComponent(agent.id)}`}
                title="Open agent settings"
                onClick={(e) => e.stopPropagation()}
                className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-secondary/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <SettingsIcon className="h-3.5 w-3.5" strokeWidth={1.85} />
                <span className="sr-only">Open agent settings</span>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentCardTools({ toolIds }: { toolIds: string[] }) {
  return (
    <span className="mt-1 block break-words text-[11px] leading-snug text-muted-foreground">
      {toolIds.length === 0 ? <span className="italic">no tools access</span> : toolIds.join(", ")}
    </span>
  );
}
