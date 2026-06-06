import { useEffect, useState } from "react";
import type { AgentListItemResponse } from "../../../backend/src/contracts/agents";
import { getAgents } from "../api/client";

/** Shared agents list — one GET /api/agents per session (see client cache). */
export function useAgents(): AgentListItemResponse[] | null {
  const [agents, setAgents] = useState<AgentListItemResponse[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAgents()
      .then((rows) => {
        if (!cancelled) setAgents(rows);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return agents;
}
