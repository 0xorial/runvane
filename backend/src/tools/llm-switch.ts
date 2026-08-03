import type { ChatEntry } from '../contracts/chatEntry.js';
import type { LlmRef } from '../thoughtProcessing/types.js';

export const SWITCH_LLM_TOOL_ID = 'switch_llm';

/**
 * What a `switch_llm` call earlier in the current run means for the next
 * planning round:
 *
 * - `none`    — no accepted switch in this run; use the model the run would
 *               use anyway.
 * - `active`  — run the round on `llm`.
 * - `expired` — a lease ran out. The caller must recompute the run's BASE
 *               model (user-message override → agent default → global) instead
 *               of reusing whatever model was threaded through the tool chain —
 *               that value is contaminated: it inherits the switched model via
 *               the previous round's downstream refs, so "fall back to the
 *               threaded llm" would silently never revert.
 */
export type LlmSwitchState = { kind: 'none' } | { kind: 'active'; llm: LlmRef } | { kind: 'expired' };

/**
 * Resolve the switch state for the current run, derived entirely from the
 * lineage — the switch's own `done` tool-invocation entry is the record, so the
 * override survives restarts and never leaks across branches. Lease semantics:
 *
 * - The window is the current run: entries after the last user-message. A new
 *   user message starts a new run, so "this_run" expires by construction.
 * - The latest accepted switch in the window wins; earlier ones are
 *   superseded, and an expired lease reverts to the run's base model — it
 *   never resurrects an older switch.
 * - "n_turns" counts spine planner thoughts created after the switch entry:
 *   once `turns` rounds have run on the override, it lapses.
 */
export function resolveLlmSwitchState(entries: readonly ChatEntry[]): LlmSwitchState {
  let windowStart = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.type === 'user-message') {
      windowStart = i + 1;
      break;
    }
  }
  for (let i = entries.length - 1; i >= windowStart; i--) {
    const entry = entries[i]!;
    if (entry.type !== 'tool-invocation' || entry.toolId !== SWITCH_LLM_TOOL_ID) continue;
    // Denied / errored / still-pending switches never took effect.
    if (entry.state !== 'done') continue;
    const params = entry.parameters;
    const providerId = typeof params.provider_id === 'string' ? params.provider_id : '';
    const model = typeof params.model_name === 'string' ? params.model_name : '';
    if (!providerId || !model) return { kind: 'none' };
    if (params.scope === 'n_turns') {
      const turns =
        typeof params.turns === 'number' && Number.isFinite(params.turns) ? Math.trunc(params.turns) : 1;
      let plannersSince = 0;
      for (let j = i + 1; j < entries.length; j++) {
        const after = entries[j]!;
        if (after.type === 'thought' && after.thoughtType === 'planner' && !after.isSide) plannersSince++;
      }
      if (plannersSince >= turns) return { kind: 'expired' };
    }
    return { kind: 'active', llm: { providerId, model } };
  }
  return { kind: 'none' };
}
