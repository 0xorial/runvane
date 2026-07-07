import { Injectable, Logger } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { LlmProviderSettingsRepo } from '../../db/repositories/llm-provider-settings.repo.js';
import { StreamInterruptedError } from '../../llmProviders/provider.js';
import { LlmProviderRegistry } from '../../llmProviders/registry.js';
import { expandAttachmentRefs } from '../../llmProviders/expandAttachments.js';
import { getCompletionText, getCompletionThinking, getCompletionToolCalls } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmStreamEvent } from '../../llmProviders/types.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import { TaskRegistryService } from '../../tasks/task-registry.service.js';
import { UploadsService } from '../../uploads/uploads.service.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';
import type { PreparedReason } from './prepareStep.js';
import { DecisionStep } from './decisionStep.js';

@Injectable()
export class ReasonStep {
  private readonly logger = new Logger(ReasonStep.name);

  constructor(
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly llmProviders: LlmProviderRegistry,
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly uploads: UploadsService,
    private readonly taskRegistry: TaskRegistryService,
    private readonly decisionStep: DecisionStep,
  ) {}

  async run<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    ctx: ThoughtContext,
    prepared: PreparedReason,
    scope: LifecycleScope,
  ): Promise<LlmCompletion> {
    scope.throwIfAborted();
    const streamEntryId = ctx.streamEntryId ?? (await this.createStreamEntry(provider, ctx, input, prepared.display));
    ctx.streamEntryId = streamEntryId;

    if (!ctx.thoughtActionEntryId) {
      ctx.thoughtActionEntryId = await this.createActionEntry(provider, ctx);
    }

    return this.taskRegistry.run(
      {
        kind: 'llm',
        title: `${provider.thoughtType} · ${ctx.llm.model}`,
        conversationId: ctx.conversationId,
        parentSignal: scope.signal,
      },
      async (taskSignal) => {
        const onAbort = () => {
          void this.setStreamStatus(ctx, streamEntryId, 'cancelled');
        };
        taskSignal.addEventListener('abort', onAbort, { once: true });
        try {
          taskSignal.throwIfAborted();
          return await this.streamLlm(provider, input, ctx, prepared, streamEntryId, taskSignal);
        } catch (error) {
          if (taskSignal.aborted) {
            await this.persistAbortedUsage(ctx, error);
            throw error;
          }
          const detail = error instanceof Error ? error.message : String(error);
          await this.setStreamStatus(ctx, streamEntryId, 'failed', detail);
          throw error;
        } finally {
          taskSignal.removeEventListener('abort', onAbort);
        }
      },
    );
  }

  private async createStreamEntry<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    ctx: ThoughtContext,
    input: TInput,
    requestDisplay: string,
  ): Promise<string> {
    // Write the full payload (incl. any thoughtType-required `extra` fields such
    // as `attachmentId`) in the initial insert. Splitting this into append +
    // merge opened a window where a /stream snapshot could read a
    // `summarize_attachment` entry before its `attachmentId` landed and fail
    // deserialization, killing the SSE connection.
    const extra = provider.streamEntryExtraPayload?.(input);
    const created = await ctx.chain.append(ctx.thoughtId, (parentId) =>
      this.chatEntries.appendThoughtStreamEntry(ctx.conversationId, {
        thoughtType: provider.thoughtType,
        thoughtId: ctx.thoughtId,
        parentId,
        status: 'running',
        llm: ctx.llm,
        llmRequest: requestDisplay,
        extra: extra ?? undefined,
      }),
    );
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async createActionEntry<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    ctx: ThoughtContext,
  ): Promise<string> {
    const created = await ctx.chain.append(ctx.thoughtId, (parentId) =>
      this.chatEntries.appendThoughtActionEntry(ctx.conversationId, {
        thoughtId: ctx.thoughtId,
        parentId,
        status: 'running',
        summary: provider.initialActionSummary ?? 'Waiting for LLM output',
      }),
    );
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async streamLlm<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    ctx: ThoughtContext,
    prepared: PreparedReason,
    streamEntryId: string,
    signal: AbortSignal,
  ): Promise<LlmCompletion> {
    const llmProvider = this.llmProviders.get(ctx.llm.providerId);
    if (!llmProvider) throw new Error(`unknown llm provider: ${ctx.llm.providerId}`);
    const providerSettings = await this.llmProviderSettings.getProviderSettings(ctx.llm.providerId);
    if (!providerSettings) throw new Error(`llm provider settings not found: ${ctx.llm.providerId}`);

    const expandedRequest = await expandAttachmentRefs(prepared.request, async (id) => {
      const content = await this.uploads.readContentById(id);
      if (!content) return null;
      return {
        filename: content.attachment.name,
        mime: content.attachment.mimeType || 'application/octet-stream',
        bytes: content.data,
      };
    });
    const wireRequest =
      ctx.llm.providerId === 'openrouter'
        ? {
            ...expandedRequest,
            requestParams: {
              ...expandedRequest.requestParams,
              session_id: ctx.conversationId,
            },
          }
        : expandedRequest;

    this.logger.log(
      `llm → ${ctx.llm.providerId}/${ctx.llm.model} turns=${wireRequest.messages.length} tools=${wireRequest.tools?.length ?? 0}`,
    );

    const startedAt = Date.now();
    const onEvent = (event: LlmStreamEvent) => {
      signal.throwIfAborted();
      provider.onLlmEvent?.(input, ctx, event);
    };

    const completion = await llmProvider.streamCompletion(
      providerSettings,
      ctx.llm.model,
      wireRequest,
      onEvent,
      signal,
    );
    signal.throwIfAborted();

    const elapsedMs = Date.now() - startedAt;
    const usage = completion.usage;
    const usageStr = usage
      ? `prompt=${usage.promptTokens} cached=${usage.cachedPromptTokens ?? 0} completion=${usage.completionTokens}${usage.costUsd != null ? ` provider_cost=$${usage.costUsd}` : ''}`
      : 'usage=unknown';
    if (usage && (usage.cachedPromptTokens ?? 0) === 0 && usage.promptTokens < 4096 && ctx.llm.model.toLowerCase().includes('opus')) {
      this.logger.debug(
        `llm cache: ${ctx.llm.model} prompt=${usage.promptTokens} tok — Opus models need ≥4096 input tok before Anthropic caching applies`,
      );
    }
    this.logger.log(
      `llm ← ${ctx.llm.providerId}/${ctx.llm.model} ${elapsedMs}ms finish=${completion.finishReason} ${usageStr}`,
    );

    const responseText = getCompletionText(completion);
    const thinkingText = getCompletionThinking(completion);
    // Raw-response view shows the provider's chunks exactly as received; fall
    // back to the assembled text for adapters that don't capture them (stub).
    const hasChunks = !!(completion.rawChunks && completion.rawChunks.length > 0);
    const rawResponse = hasChunks ? JSON.stringify(completion.rawChunks, null, 2) : responseText;
    // Assembled view: the COMPLETE response with only the streaming chunking
    // removed — no extraction, no invented markup. A plain-text reply assembles
    // to its text; a reply with native tool_call parts assembles to the message
    // JSON those chunks add up to.
    const nativeCalls = getCompletionToolCalls(completion);
    const assembledResponse =
      nativeCalls.length === 0
        ? responseText
        : JSON.stringify(
            {
              ...(responseText ? { content: responseText } : {}),
              tool_calls: nativeCalls.map((call) => ({
                id: call.callId,
                name: call.toolName,
                arguments: call.args,
              })),
            },
            null,
            2,
          );
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, streamEntryId, {
      status: 'completed',
      llmResponse: rawResponse,
      // Only stored when it differs from the raw view (i.e. the provider
      // streamed chunks).
      ...(hasChunks && assembledResponse ? { assembledResponse } : {}),
      ...(thinkingText ? { thinkingText } : {}),
      thoughtMs: Date.now() - startedAt,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, streamEntryId);
    return completion;
  }

  private async persistAbortedUsage(ctx: ThoughtContext, error: unknown): Promise<void> {
    if (!(error instanceof StreamInterruptedError) || !error.usage) return;
    await this.decisionStep.recordUsage(ctx, {
      parts: [],
      finishReason: 'stop',
      usage: error.usage,
    });
  }

  private async setStreamStatus(
    ctx: ThoughtContext,
    streamEntryId: string,
    status: 'failed' | 'cancelled',
    errorDetail?: string,
  ): Promise<void> {
    const patch: Record<string, unknown> = { status };
    if (errorDetail) patch.error = errorDetail;
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, streamEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, streamEntryId);
  }
}
