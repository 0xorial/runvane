import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolPermissionContext,
} from "../../baseTool.js";
import {
  getCurrentTimeParamsSchema,
  parseGetCurrentTimeToolParams,
  type GetCurrentTimeToolParams,
} from "./params.js";
import {
  getCurrentTimeRulesSchema,
  parseGetCurrentTimeToolRules,
  type GetCurrentTimeToolRules,
} from "./rules.js";

export class GetCurrentTimeTool extends BaseTool<
  GetCurrentTimeToolParams,
  GetCurrentTimeToolRules
> {
  getName(): string {
    return "get_current_time";
  }

  getAiDescription(): string {
    return "Returns current server time as an ISO timestamp. Use when user asks for current time/date.";
  }

  getHumanDescription(): string {
    return "Get current server time.";
  }

  getParamsSchema(): Record<string, unknown> {
    return getCurrentTimeParamsSchema();
  }

  getRulesSchema(): Record<string, unknown> {
    return getCurrentTimeRulesSchema();
  }

  getDefaultRules(): GetCurrentTimeToolRules {
    return { allowed: "always" };
  }

  parseParams(raw: unknown): GetCurrentTimeToolParams {
    return parseGetCurrentTimeToolParams(raw);
  }

  parseRules(raw: unknown): GetCurrentTimeToolRules {
    return parseGetCurrentTimeToolRules(raw);
  }

  evaluatePermission(
    context: ToolPermissionContext<GetCurrentTimeToolRules>,
  ): RuleEvaluationResult[] {
    const allowedRule = context.agentToolConfig.rules.allowed;
    const permission =
      allowedRule === "always"
        ? "allow"
        : allowedRule === "never"
        ? "forbid"
        : "ask_user";
    return [
      {
        ruleName: "allowed",
        permission,
        detail: `Rule allowed='${allowedRule}'.`,
      },
    ];
  }

  runTool(_params: GetCurrentTimeToolParams): unknown {
    return {
      nowIso: new Date().toISOString(),
    };
  }
}
