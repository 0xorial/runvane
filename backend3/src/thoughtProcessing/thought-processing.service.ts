import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ChatChain } from '../conversations/chat-chain.js';
import { LifecycleScope } from '../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { LlmProviderSettingsRepo } from '../db/repositories/llm-provider-settings.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../sse/sse-helpers.js';
import { AutoTitleThoughtTypeProvider } from './thoughtTypeProviders/autoTitleProvider.js';
import { PlannerThoughtTypeProvider } from './thoughtTypeProviders/plannerProvider.js';
import { ToolParamsThoughtTypeProvider } from './thoughtTypeProviders/toolParamsProvider.js';
import {
  isThoughtStreamEntry,
  type LlmRef,
  type PreparedReason,
  type ThoughtContext,
  type ThoughtReasonLlmResult,
  type ThoughtTypeProvider,
} from './types.js';
import { DecisionStep } from './steps/decisionStep.js';
import { PrepareStep } from './steps/prepareStep.js';
import { ReasonStep } from './steps/reasonStep.js';

type AnyThoughtProvider = ThoughtTypeProvider<any>;

@Injectable()
export class ThoughtProcessingService {
  private readonly providers: AnyThoughtProvider[];

  constructor(
    private readonly prepareStep: PrepareStep,
    private readonly reasonStep: ReasonStep,
    private readonly decisionStep: DecisionStep,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly hub: SseHubService,
    autoTitleProvider: AutoTitleThoughtTypeProvider,
    @Inject(forwardRef(() => PlannerThoughtTypeProvider))
    plannerProvider: PlannerThoughtTypeProvider,
    toolParamsProvider: ToolParamsThoughtTypeProvider,
  ) {
    this.providers = [autoTitleProvider, plannerProvider, toolParamsProvider];
  }

  /**
   * Synchronously fetches the active LLM reference. The conversation-processor
   * calls this once per run and threads the result into the start* methods so
   * each can call `chain.append` synchronously and preserve caller-order on
   * the run's chain mutex.
   */
  async getLlmRef(): Promise<LlmRef> {
    const llmDoc = await this.llmProviderSettings.getDocument();
    return {
      providerId: llmDoc.llm_configuration.provider_id,
      model: llmDoc.llm_configuration.model_name,
    };
  }

  /**
   * Starts a thought on the run's chain.
   *
   * The prepare-entry append is enqueued on `chain` synchronously, before
   * `scope.spawn`, so concurrent thoughts land on the chain in caller-call
   * order rather than racing on microtask resolution.
   *
   * `input` is optional: when omitted, `provider.buildInputFromConversation`
   * resolves it inside the spawned task (must be defined).
   */
  startThought<TInput>(args: {
    provider: ThoughtTypeProvider<TInput>;
    conversationId: string;
    scope: LifecycleScope;
    chain: ChatChain;
    llm: LlmRef;
    input?: TInput;
  }): void {
    const { provider, conversationId, scope, chain, llm } = args;
    scope.throwIfAborted();
    const buildInput = provider.buildInputFromConversation;
    if (args.input === undefined && !buildInput) {
      throw new Error(`provider ${provider.constructor.name} cannot self-initiate; pass input explicitly`);
    }
    const ctx = this.createContext(conversationId, chain, llm);
    const prepareCreatePromise = this.appendPreparePlaceholder(ctx, provider);
    scope.spawn(async () => {
      const input = args.input ?? (await buildInput!(conversationId));
      const prepareEntry = await prepareCreatePromise;
      ctx.prepareEntryId = prepareEntry.id;
      await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, prepareEntry.id);
      const prepared = await this.prepareStep.run(provider, input, ctx, scope);
      const llmResult = await this.reasonStep.run(provider, input, ctx, prepared, scope);
      await this.decisionStep.run(provider, input, ctx, llmResult, scope);
    });
  }

  private appendPreparePlaceholder(ctx: ThoughtContext, provider: AnyThoughtProvider): Promise<{ id: string }> {
    return ctx.chain.append((parentId) =>
      this.chatEntries.appendThoughtPrepareEntry(ctx.conversationId, {
        thoughtId: ctx.thoughtId,
        parentId,
        status: 'running',
        title: provider.prepareTitle,
        llmProviderId: ctx.llmProviderId,
        llmModel: ctx.llmModel,
      }),
    );
  }

  async startReprocessContext(
    args: { conversationId: string; sourceEntryId: string; editedRequestText: string },
    scope: LifecycleScope,
    chain: ChatChain,
    llm: LlmRef,
  ): Promise<{ plannerEntryId: string }> {
    scope.throwIfAborted();
    const editedRequestText = args.editedRequestText.trim();
    if (!editedRequestText) throw new Error('editedRequestText is required');
    const branch = await this.resolvePrepareSource(args.conversationId, args.sourceEntryId);
    const provider = await this.resolveProviderForThought(args.conversationId, branch.thoughtId);
    if (!provider.buildInputFromConversation) {
      throw new Error(`provider ${provider.constructor.name} cannot build input from conversation`);
    }
    chain.setTip(branch.parentId);

    const ctx = this.createContext(args.conversationId, chain, llm);
    ctx.prepareEntryId = await this.appendCompletedPrepareEntry(ctx, provider, editedRequestText);
    ctx.streamEntryId = await this.appendRunningStreamEntry(ctx, provider, editedRequestText);
    const plannerEntryId = ctx.streamEntryId;

    scope.spawn(async () => {
      const input = await provider.buildInputFromConversation!(args.conversationId);
      const prepared: PreparedReason = { prompt: editedRequestText };
      const llmResult = await this.reasonStep.run(provider, input, ctx, prepared, scope);
      await this.decisionStep.run(provider, input, ctx, llmResult, scope);
    });
    return { plannerEntryId };
  }

  async startReprocessReason(
    args: { conversationId: string; sourceEntryId: string; editedResponse: string },
    scope: LifecycleScope,
    chain: ChatChain,
    llm: LlmRef,
  ): Promise<{ plannerEntryId: string }> {
    scope.throwIfAborted();
    const editedResponse = args.editedResponse.trim();
    if (!editedResponse) throw new Error('editedResponse is required');
    const source = await this.resolveStreamSource(args.conversationId, args.sourceEntryId);
    const provider = source.provider;
    if (!provider.buildInputFromConversation) {
      throw new Error(`provider ${provider.constructor.name} cannot build input from conversation`);
    }
    chain.setTip(source.prepareEntryId);

    const ctx = this.createContext(args.conversationId, chain, llm, { thoughtId: source.thoughtId });
    if (source.llmProviderId) ctx.llmProviderId = source.llmProviderId;
    if (source.llmModel) ctx.llmModel = source.llmModel;
    ctx.prepareEntryId = source.prepareEntryId;
    ctx.streamEntryId = await this.appendCompletedStreamEntry(ctx, provider, source.llmRequest, editedResponse);
    ctx.thoughtActionEntryId = await this.appendRunningActionEntry(ctx, provider);
    const plannerEntryId = ctx.streamEntryId;

    scope.spawn(async () => {
      const input = await provider.buildInputFromConversation!(args.conversationId);
      const llmResult: ThoughtReasonLlmResult = { fullResponse: editedResponse };
      if (source.llmProviderId) llmResult.providerId = source.llmProviderId;
      if (source.llmModel) llmResult.model = source.llmModel;
      await this.decisionStep.run(provider, input, ctx, llmResult, scope);
    });
    return { plannerEntryId };
  }

  private createContext(
    conversationId: string,
    chain: ChatChain,
    llm: LlmRef,
    opts: { thoughtId?: string } = {},
  ): ThoughtContext {
    return {
      thoughtId: opts.thoughtId ?? crypto.randomUUID(),
      conversationId,
      llmProviderId: llm.providerId,
      llmModel: llm.model,
      prepareEntryId: null,
      streamEntryId: null,
      thoughtActionEntryId: null,
      chain,
    };
  }

  private async resolvePrepareSource(
    conversationId: string,
    sourceEntryId: string,
  ): Promise<{ prepareEntryId: string; parentId: string | null; thoughtId: string }> {
    const sourceEntry = await this.chatEntries.getChatEntry(conversationId, sourceEntryId);
    if (!sourceEntry) throw new Error(`source entry not found: ${sourceEntryId}`);
    if (sourceEntry.type !== 'thought-prepare') {
      throw new Error(`reprocess-context source ${sourceEntryId} is not a thought-prepare (got ${sourceEntry.type})`);
    }
    return { prepareEntryId: sourceEntry.id, parentId: sourceEntry.parentId, thoughtId: sourceEntry.thoughtId };
  }

  /**
   * Provider for a thought is identified by the stream entry's type.
   * With chain-interleaved appends the stream is no longer guaranteed to be
   * the prepare's direct child, so we look up by `thoughtId` instead of
   * walking parents.
   */
  private async resolveProviderForThought(conversationId: string, thoughtId: string): Promise<AnyThoughtProvider> {
    const all = await this.chatEntries.listChatEntries(conversationId, { all: true });
    const streamEntry = all.find((e) => isThoughtStreamEntry(e) && e.thoughtId === thoughtId);
    if (!streamEntry) {
      throw new Error(`thought ${thoughtId} has no stream entry to identify provider`);
    }
    const provider = this.providers.find((p) => p.streamEntryType === streamEntry.type);
    if (!provider) {
      throw new Error(`no provider registered for stream entry type ${streamEntry.type}`);
    }
    return provider;
  }

  private async resolveStreamSource(
    conversationId: string,
    sourceEntryId: string,
  ): Promise<{
    provider: AnyThoughtProvider;
    thoughtId: string;
    prepareEntryId: string;
    llmRequest: string;
    llmProviderId?: string;
    llmModel?: string;
  }> {
    const source = await this.chatEntries.getChatEntry(conversationId, sourceEntryId);
    if (!source) throw new Error(`source entry not found: ${sourceEntryId}`);
    if (!isThoughtStreamEntry(source)) {
      throw new Error(`reprocess-reason source entry is not a stream entry: ${source.type}`);
    }
    const provider = this.providers.find((p) => p.streamEntryType === source.type);
    if (!provider) {
      throw new Error(`no provider registered for stream entry type ${source.type}`);
    }
    if (!source.parentId) throw new Error(`${source.type} ${sourceEntryId} has no parent`);
    const out: {
      provider: AnyThoughtProvider;
      thoughtId: string;
      prepareEntryId: string;
      llmRequest: string;
      llmProviderId?: string;
      llmModel?: string;
    } = {
      provider,
      thoughtId: source.thoughtId,
      prepareEntryId: source.parentId,
      llmRequest: source.llmRequest,
    };
    if (source.llmProviderId) out.llmProviderId = source.llmProviderId;
    if (source.llmModel) out.llmModel = source.llmModel;
    return out;
  }

  private async appendCompletedPrepareEntry(
    ctx: ThoughtContext,
    provider: AnyThoughtProvider,
    requestText: string,
  ): Promise<string> {
    const created = await ctx.chain.append((parentId) =>
      this.chatEntries.appendThoughtPrepareEntry(ctx.conversationId, {
        thoughtId: ctx.thoughtId,
        parentId,
        status: 'completed',
        requestText,
        title: provider.prepareTitle,
        llmProviderId: ctx.llmProviderId,
        llmModel: ctx.llmModel,
      }),
    );
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async appendRunningStreamEntry(
    ctx: ThoughtContext,
    provider: ThoughtTypeProvider<unknown>,
    llmRequest: string,
  ): Promise<string> {
    const created = await ctx.chain.append((parentId) =>
      this.chatEntries.appendThoughtStreamEntry(ctx.conversationId, {
        type: provider.streamEntryType,
        thoughtId: ctx.thoughtId,
        parentId,
        status: 'running',
        llmProviderId: ctx.llmProviderId,
        llmModel: ctx.llmModel,
      }),
    );
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, created.id, { llmRequest });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async appendRunningActionEntry(ctx: ThoughtContext, provider: ThoughtTypeProvider<unknown>): Promise<string> {
    const created = await ctx.chain.append((parentId) =>
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

  private async appendCompletedStreamEntry(
    ctx: ThoughtContext,
    provider: AnyThoughtProvider,
    llmRequest: string,
    llmResponse: string,
  ): Promise<string> {
    const created = await ctx.chain.append((parentId) =>
      this.chatEntries.appendThoughtStreamEntry(ctx.conversationId, {
        type: provider.streamEntryType,
        thoughtId: ctx.thoughtId,
        parentId,
        status: 'completed',
        llmProviderId: ctx.llmProviderId,
        llmModel: ctx.llmModel,
      }),
    );
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, created.id, {
      llmRequest,
      llmResponse,
      thoughtMs: 0,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }
}
