import { resolveThoughtTypeProvider } from "../thoughtTypeProviders/index.js";
import type { DecisionStepInput } from "../types.js";
import { createStepHandle } from "./stepHandle.js";

export async function runDecisionStep(
  input: DecisionStepInput,
  _opts?: { shouldCancel?: () => boolean }
): Promise<void> {
  const provider = resolveThoughtTypeProvider(input.thought.thoughtType);
  const step = await createStepHandle("decision", input.thought);
  await provider.runDecision(step, input);
}
