import { getCompletionText, getCompletionToolCalls, type LlmCompletion } from '../../llmProviders/types.js';

/**
 * A completion the provider ended with its refusal stop reason and no
 * content: Anthropic's `refusal` (mapped to finish 'content_filter'), where
 * the model's safety classifier stopped the turn before any output. Left
 * alone it reads as an empty reply and the chat shows nothing; the thought
 * must fail visibly instead.
 */
export function refusedCompletion(completion: LlmCompletion): boolean {
  return (
    completion.finishReason === 'content_filter' &&
    getCompletionText(completion).trim() === '' &&
    getCompletionToolCalls(completion).length === 0
  );
}

export function refusalMessage(model: string): string {
  return (
    `${model} refused this request: the provider ended the turn with its refusal stop reason and returned ` +
    "nothing, so nothing ran. Retry, pick another model, or change the agent's planner reply format (Settings, Agents)."
  );
}
