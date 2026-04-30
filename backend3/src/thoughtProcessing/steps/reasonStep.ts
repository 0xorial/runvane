import { resolveThoughtTypeProvider, type AnyThoughtTypeProvider } from '../thoughtTypeProviders/index.js';
import type { DecisionStepInput, ReasonStepInput } from '../types.js';
import { runDecisionStep } from './decisionStep.js';
import { getThoughtRuntimeDeps } from './runtimeDeps.js';
import { createStepHandle } from './stepHandle.js';

export async function runReasonStep(input: ReasonStepInput, opts?: { signal?: AbortSignal }): Promise<void> {
  opts?.signal?.throwIfAborted();
  const provider = resolveThoughtTypeProvider(input.thought.thoughtType);
  const step = await createStepHandle('reason', input.thought as { conversationId?: string });
  const decisionInput = await provider.runReason(step, input);
  const runtimeInput = await executeReasonRuntime(provider, decisionInput, opts);
  opts?.signal?.throwIfAborted();
  await runDecisionStep(runtimeInput);
}

async function executeReasonRuntime(
  provider: AnyThoughtTypeProvider,
  decisionInput: DecisionStepInput,
  opts?: { signal?: AbortSignal },
): Promise<DecisionStepInput> {
  const request = provider.getReasonLlmRequest?.(decisionInput) ?? null;
  if (!request) return decisionInput;
  const deps = getThoughtRuntimeDeps();
  const llmDoc = await deps.llmProviderSettings.getDocument();
  const providerId = llmDoc.llm_configuration.provider_id;
  const modelName = llmDoc.llm_configuration.model_name;
  const llmProvider = deps.llmProviderRegistry.get(providerId);
  if (!llmProvider) throw new Error(`unknown llm provider: ${providerId}`);
  const providerSettings = await deps.llmProviderSettings.getProviderSettings(providerId);
  if (!providerSettings) throw new Error(`llm provider settings not found: ${providerId}`);

  let streamedText = '';
  const completion = await llmProvider.streamTextCompletion(
    providerSettings,
    { model: modelName, prompt: request.prompt },
    (delta) => {
      opts?.signal?.throwIfAborted();
      streamedText += delta;
      provider.onReasonLlmDelta?.(decisionInput, delta);
    },
  );
  opts?.signal?.throwIfAborted();
  if (!provider.applyReasonLlmResult) return decisionInput;
  return provider.applyReasonLlmResult(decisionInput, {
    fullResponse: String(completion.text || streamedText),
    providerId,
    model: modelName,
    ...(completion.usage ? { usage: completion.usage } : {}),
  });
}
