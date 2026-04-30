import { resolveThoughtTypeProvider } from '../thoughtTypeProviders/index.js';
import type { DecisionStepInput } from '../types.js';
import { createStepHandle } from './stepHandle.js';

export async function runDecisionStep(input: DecisionStepInput): Promise<void> {
  const provider = resolveThoughtTypeProvider(input.thought.thoughtType);
  const step = await createStepHandle('decision', input.thought as { conversationId?: string });
  await provider.runDecision(step, input);
}
