import { resolveThoughtTypeProvider } from "../thoughtTypeProviders/index.js";
import type { DecisionStepInput, DecisionStepInput2, ThoughtTypeProvider2 } from "../types.js";
import { createStepHandle } from "./stepHandle.js";

export async function runDecisionStep(
  input: DecisionStepInput,
  _opts?: { signal?: AbortSignal }
): Promise<void> {
  const provider = resolveThoughtTypeProvider(input.thought.thoughtType);
  const step = await createStepHandle("decision", input.thought);
  await provider.runDecision(step, input);
}

export async function runDecisionStep2(
  input: DecisionStepInput2,
  provider: ThoughtTypeProvider2,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await provider.runDecision(input, signal);
}
