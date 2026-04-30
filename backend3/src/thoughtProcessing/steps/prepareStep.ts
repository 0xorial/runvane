import type { PrepareStepInput } from '../types.js';
import { runReasonStep } from './reasonStep.js';
import { createStepHandle } from './stepHandle.js';
import { resolveThoughtTypeProvider } from '../thoughtTypeProviders/index.js';

export async function runPrepareStep(input: PrepareStepInput, opts?: { signal?: AbortSignal }): Promise<void> {
  opts?.signal?.throwIfAborted();
  const provider = resolveThoughtTypeProvider(input.thought.thoughtType);
  const step = await createStepHandle('prepare', input.thought as { conversationId?: string });
  const reasonInput = await provider.runPrepare(step, input);
  opts?.signal?.throwIfAborted();
  await runReasonStep(reasonInput, opts);
}
