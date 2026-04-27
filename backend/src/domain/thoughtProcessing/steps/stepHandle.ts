import type { ThoughtExecution, ThoughtStepHandle } from "../types.js";
import { updateThoughtActionEntryAndPublish } from "../../thoughtLifecycle.js";
import { getThoughtRuntimeDeps } from "./runtimeDeps.js";

type StepThought = Partial<ThoughtExecution> & {
  conversationId?: string;
  thoughtActionEntryId?: string | null;
};

const STEP_SUMMARY: Record<ThoughtStepHandle["step"], string> = {
  prepare: "Preparing context",
  reason: "Reasoning",
  decision: "Applying decision",
};

export async function createStepHandle(
  step: ThoughtStepHandle["step"],
  thought: StepThought
): Promise<ThoughtStepHandle> {
  if (!thought.conversationId || !thought.thoughtActionEntryId) return { step };
  const deps = getThoughtRuntimeDeps();
  updateThoughtActionEntryAndPublish(
    { chatEntries: deps.chatEntries, hub: deps.hub },
    {
      conversationId: thought.conversationId,
      id: thought.thoughtActionEntryId,
      status: "running",
      summary: STEP_SUMMARY[step],
    }
  );
  return { step };
}
