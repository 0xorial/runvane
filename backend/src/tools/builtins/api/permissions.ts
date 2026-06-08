import type { RuleEvaluationResult } from '../../base-tool.js';
import type { ApiToolRules } from './rules.js';

export function evaluateApiToolPermission(allowedRule: ApiToolRules['allowed']): RuleEvaluationResult[] {
  if (allowedRule === 'never') {
    return [{ ruleName: 'allowed', permission: 'forbid', detail: `Rule allowed='never'.` }];
  }
  return [{ ruleName: 'allowed', permission: 'ask_user', detail: 'api tool always requires user approval.' }];
}
