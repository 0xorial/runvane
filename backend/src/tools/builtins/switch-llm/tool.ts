import { Injectable } from '@nestjs/common';
import { zerialize } from 'zodex';
import { LlmProviderRegistry } from '../../../llmProviders/registry.js';
import { LlmProviderSettingsRepo } from '../../../db/repositories/llm-provider-settings.repo.js';
import { BaseTool, type ToolPolicy, type ToolRunContext } from '../../base-tool.js';
import { parseSwitchLlmParams, switchLlmParamsSchema, type SwitchLlmParams } from './params.js';
import { SwitchLlmRulesSchema, parseSwitchLlmRules, type SwitchLlmRules } from './rules.js';

/**
 * In-place model switch for the current run — same context, different engine.
 *
 * The tool itself only validates and confirms; the switch is a fact recorded by
 * this call's `done` tool-invocation entry on the spine. Every post-tool
 * planner continuation resolves its model through `resolveActiveLlmSwitch`
 * (tools/llm-switch.ts), which reads that entry back from the lineage — so the
 * override is DB-derived, restart-safe, and branch-correct, with nothing held
 * in memory.
 *
 * The switch is a lease, not a latch: the caller states the revert point at
 * switch time ("this_run" ends at the next user message; "n_turns" after that
 * many planning rounds), and the harness reverts on its own — the switched-to
 * model never has to be smart enough to switch back. Contrast with
 * `delegate_to_llm`, which forks a fresh context instead of re-engining this one.
 */
@Injectable()
export class SwitchLlmTool extends BaseTool<SwitchLlmParams, SwitchLlmRules> {
  constructor(
    private readonly registry: LlmProviderRegistry,
    private readonly settingsRepo: LlmProviderSettingsRepo,
  ) {
    super();
  }

  getName(): string {
    return 'switch_llm';
  }

  getAiDescription(): string {
    return (
      'Switch the model running YOUR next planning rounds (same conversation context, different model) — ' +
      'escalate to a stronger model for a hard step or drop to a cheaper one for grunt work. ' +
      'Takes effect from the next round. Reverts automatically: scope "this_run" (default) at the next ' +
      'user message, "n_turns" after `turns` rounds. To consult another model without switching, use delegate_to_llm.'
    );
  }

  getHumanDescription(): string {
    return 'Let the agent switch its own model for the rest of the run, with automatic revert.';
  }

  getParamsSchema(): unknown {
    return switchLlmParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(SwitchLlmRulesSchema);
  }

  getDefaultRules(): SwitchLlmRules {
    return parseSwitchLlmRules({});
  }

  getDefaultPolicy(): ToolPolicy {
    // The reachable models are already bounded by allowed_models + the
    // user-configured providers; prompting per switch would defeat the tool.
    return 'allow';
  }

  parseParams(raw: unknown): SwitchLlmParams {
    return parseSwitchLlmParams(raw);
  }

  parseRules(raw: unknown): SwitchLlmRules {
    return parseSwitchLlmRules(raw);
  }

  async runTool(params: SwitchLlmParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseSwitchLlmRules(context.toolRules ?? this.getDefaultRules());
    context.signal.throwIfAborted();

    const target = `${params.provider_id}/${params.model_name}`;
    if (rules.allowed_models.length > 0 && !rules.allowed_models.includes(target)) {
      throw new Error(
        `switch_llm: '${target}' is not in allowed_models [${rules.allowed_models.join(', ')}]`,
      );
    }
    if (!this.registry.get(params.provider_id)) {
      throw new Error(`switch_llm: unknown provider '${params.provider_id}'`);
    }
    if (!(await this.settingsRepo.getProviderSettings(params.provider_id))) {
      throw new Error(`switch_llm: no settings found for provider '${params.provider_id}'`);
    }

    const reverts =
      params.scope === 'n_turns'
        ? `after ${params.turns} planning round(s)`
        : 'when the current run ends (next user message)';
    context.log?.(`switching to ${target}, reverts ${reverts}`);
    return {
      switched_to: { provider_id: params.provider_id, model_name: params.model_name },
      scope: params.scope,
      ...(params.turns !== undefined ? { turns: params.turns } : {}),
      effective: 'from the next planning round',
      reverts,
    };
  }
}
