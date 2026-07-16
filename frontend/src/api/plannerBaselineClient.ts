// Planner-baseline preview API. Same isolation pattern as knowledgeClient.
import type { AgentToolConfig } from "../../../backend/src/agents/agent.entity";
import type {
  PlannerBaselinePreviewRequest,
  PlannerBaselinePreviewResult,
} from "../../../backend/src/contracts/planner-baseline";
import { sendJson } from "./client";

export type { PlannerBaselinePreviewResult } from "../../../backend/src/contracts/planner-baseline";

export function previewPlannerBaseline(input: PlannerBaselinePreviewRequest): Promise<PlannerBaselinePreviewResult> {
  return sendJson("/api/planner-baseline/preview", "POST", input) as Promise<PlannerBaselinePreviewResult>;
}

/** Shared query options so every consumer (Start context block, composer
 *  tooltip) dedupes onto one fetch per (agent, tool-overrides draft) pair. */
export function plannerBaselineQueryOptions(agentId: string, toolOverrides: Record<string, AgentToolConfig> | undefined) {
  return {
    queryKey: ["planner-baseline", agentId, toolOverrides ? JSON.stringify(toolOverrides) : ""] as const,
    queryFn: () => previewPlannerBaseline({ agentId, ...(toolOverrides ? { toolOverrides } : {}) }),
    enabled: Boolean(agentId),
    staleTime: 15_000,
  };
}
