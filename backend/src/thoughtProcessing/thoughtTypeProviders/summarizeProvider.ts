import { Injectable } from '@nestjs/common';
import type { ChatEntry } from '../../contracts/chatEntry.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { getCompletionText, textMessage } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmMessage, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishStreamFieldDelta } from '../../sse/sse-helpers.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';

export type SummarizeInput = {
  conversationId: string;
  /** First entry in the range (inclusive). Anchors the summary's parent. */
  fromEntryId: string;
  /** Last entry in the range (inclusive). */
  toEntryId: string;
  /** Pre-resolved entries in the range, in conversation order. */
  rangeEntries: ChatEntry[];
  /** Number of user-visible entries in the folded range. */
  rangeEntryCount: number;
};

/**
 * Folds a tail of the conversation into a single `checkpoint-summary` entry.
 *
 * The active chain is repointed to `parent(fromEntryId)` BEFORE the run
 * starts (by the conversation processor), so the prepare/stream entries
 * and the resulting checkpoint-summary attach as a sibling branch. The
 * original turns stay reachable on their own branch via the branch
 * selector — folding is non-destructive.
 *
 * Reuses the standard prepare/reason flow: the prepare entry exposes the
 * exact LlmRequest for editing, the stream entry shows live progress, and
 * `runDecision` writes the final `checkpoint-summary` entry.
 */
@Injectable()
export class SummarizeThoughtTypeProvider implements ThoughtTypeProvider<SummarizeInput> {
  readonly streamEntryType = 'summarize_llm_stream' as const;
  readonly wantsAction = false;
  readonly prepareTitle = 'Summarize tail';

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: SseHubService,
  ) {}

  runPrepare = (input: SummarizeInput): LlmRequest => ({
    messages: buildSummarizeMessages(input.rangeEntries),
  });

  onLlmEvent = (_input: SummarizeInput, ctx: ThoughtContext, event: LlmStreamEvent): void => {
    if (!ctx.streamEntryId) return;
    publishStreamFieldDelta(this.hub, ctx.conversationId, ctx.streamEntryId, event);
  };

  runDecision = async (
    input: SummarizeInput,
    ctx: ThoughtContext,
    completion: LlmCompletion,
  ): Promise<void> => {
    const summaryText = getCompletionText(completion).trim();
    if (!summaryText) {
      throw new Error('summarize produced empty output');
    }
    const created = await ctx.chain.append((parentId) =>
      this.chatEntries.appendCheckpointSummary(ctx.conversationId, {
        parentId,
        summarizedRange: { fromEntryId: input.fromEntryId, toEntryId: input.toEntryId },
        summaryText,
        rangeEntryCount: input.rangeEntryCount,
        rangeInputTokens:
          (completion.usage?.promptTokens ?? 0) + (completion.usage?.cachedPromptTokens ?? 0) || undefined,
        summaryTokens: completion.usage?.completionTokens,
      }),
    );
    // Switch the user's default view to the freshly-folded branch so reload
    // mirrors what they see live. The original tail remains on its own branch.
    await this.chatEntries.setDefaultViewLeaf(ctx.conversationId, created.id);
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
  };
}

function buildSummarizeMessages(entries: ChatEntry[]): LlmMessage[] {
  return [
    textMessage(
      'system',
      'Condense the following conversation turns into a faithful summary. ' +
        'Preserve facts, decisions, open questions, and references to artifacts/files/tools by id. ' +
        'Do not editorialize or add commentary. Do not address the user. Output only the summary text.',
    ),
    textMessage('user', renderTurnsForSummary(entries)),
  ];
}

function renderTurnsForSummary(entries: ChatEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    switch (e.type) {
      case 'user-message':
        lines.push(`<user>\n${e.text}\n</user>`);
        break;
      case 'assistant-message':
        lines.push(`<assistant>\n${e.text}\n</assistant>`);
        break;
      case 'tool-invocation':
        lines.push(
          `<tool name="${e.toolId}" state="${e.state}">\n` +
            `params: ${stringify(e.parameters)}\n` +
            `result: ${stringify(e.result)}\n` +
            `</tool>`,
        );
        break;
      case 'checkpoint-summary':
        lines.push(`<earlier-summary>\n${e.summaryText}\n</earlier-summary>`);
        break;
      // Thought scaffolding (prepare/stream/action) is internal plumbing,
      // not user-visible content; skip from the summary input.
      case 'thought-prepare':
      case 'thought-action':
      case 'planner_llm_stream':
      case 'title_llm_stream':
      case 'tool_params_llm_stream':
      case 'summarize_llm_stream':
      case 'guardrail_llm_stream':
        break;
      default: {
        const _exhaustive: never = e;
        throw new Error(`renderTurnsForSummary: unhandled type ${(_exhaustive as ChatEntry).type}`);
      }
    }
  }
  return lines.join('\n\n');
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
