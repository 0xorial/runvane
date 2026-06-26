import { Injectable } from '@nestjs/common';
import { BaseTool, type ToolPolicy } from '../../base-tool.js';
import {
  getCurrentTimeParamsSchema,
  parseGetCurrentTimeToolParams,
  type GetCurrentTimeToolParams,
} from './params.js';
import { zerialize } from 'zodex';
import {
  GetCurrentTimeToolRulesSchema,
  parseGetCurrentTimeToolRules,
  type GetCurrentTimeToolRules,
} from './rules.js';

@Injectable()
export class GetCurrentTimeTool extends BaseTool<GetCurrentTimeToolParams, GetCurrentTimeToolRules> {
  getName(): string {
    return 'get_current_time';
  }

  getAiDescription(): string {
    return 'Returns current server time as an ISO timestamp. Use when user asks for current time/date.';
  }

  getHumanDescription(): string {
    return 'Get current server time.';
  }

  getParamsSchema(): unknown {
    return getCurrentTimeParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(GetCurrentTimeToolRulesSchema);
  }

  getDefaultRules(): GetCurrentTimeToolRules {
    return {};
  }

  getDefaultPolicy(): ToolPolicy {
    return 'allow';
  }

  parseParams(raw: unknown): GetCurrentTimeToolParams {
    return parseGetCurrentTimeToolParams(raw);
  }

  parseRules(raw: unknown): GetCurrentTimeToolRules {
    return parseGetCurrentTimeToolRules(raw);
  }

  runTool(_params: GetCurrentTimeToolParams): unknown {
    return { nowIso: new Date().toISOString() };
  }
}
