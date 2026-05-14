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

  startFullThought<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    scope: LifecycleScope,
    chain: ChatChain,
  ): void {
    scope.throwIfAborted();
    const conversationId = (input as { conversationId?: unknown }).conversationId;
    if (typeof conversationId !== 'string' || !conversationId) {
      throw new Error('startFullThought requires input.conversationId');
    }
    scope.spawn(async () => {
      const ctx = await this.createContext(conversationId, chain);
      const prepared = await this.prepareStep.run(provider, input, ctx, scope);
      const llmResult = await this.reasonStep.run(provider, input, ctx, prepared, scope);
      await this.decisionStep.run(provider, input, ctx, llmResult, scope);
    });
  }

  startSelfInitiatedThought<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    conversationId: string,
    scope: LifecycleScope,
    chain: ChatChain,
  ): void {
    if (!provider.buildInputFromConversation) {
      throw new Error(`provider ${provider.constructor.name} cannot self-initiate`);
    }
    const buildInput = provider.buildInputFromConversation;
    scope.throwIfAborted();
    scope.spawn(async () => {
      const input = await buildInput(conversationId);
      const ctx = await this.createContext(conversationId, chain);
      const prepared = await this.prepareStep.run(provider, input, ctx, scope);
      const llmResult = await this.reasonStep.run(provider, input, ctx, prepared, scope);
      await this.decisionStep.run(provider, input, ctx, llmResult, scope);
    });
  }

  async startReprocessContext(
    args: { conversationId: string; sourceEntryId: string; editedRequestText: string },
    scope: LifecycleScope,
    chain: ChatChain,
  ): Promise<{ plannerEntryId: string }> {
    scope.throwIfAborted();
    const editedRequestText = args.editedRequestText.trim();
    if (!editedRequestText) throw new Error('editedRequestText is required');
    const branch = await this.resolveBranchedPrepareSource(args.conversationId, args.sourceEntryId);
    const provider = await this.resolveProviderForPrepare(args.conversationId, branch.prepareEntryId);
    if (!provider.buildInputFromConversation) {
      throw new Error(`provider ${provider.constructor.name} cannot build input from conversation`);
    }
    chain.setTip(branch.parentId);

    const ctx = await this.createContext(args.conversationId, chain);
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

    const ctx = await this.createContext(args.conversationId, chain, { thoughtId: source.thoughtId });
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

  private async createContext(
    conversationId: string,
    chain: ChatChain,
    opts: { thoughtId?: string } = {},
  ): Promise<ThoughtContext> {
    const llmDoc = await this.llmProviderSettings.getDocument();
    return {
      thoughtId: opts.thoughtId ?? crypto.randomUUID(),
      conversationId,
      llmProviderId: llmDoc.llm_configuration.provider_id,
      llmModel: llmDoc.llm_configuration.model_name,
      prepareEntryId: null,
      streamEntryId: null,
      thoughtActionEntryId: null,
      chain,
    };
  }

  private async resolveBranchedPrepareSource(
    conversationId: string,
    sourceEntryId: string,
  ): Promise<{ prepareEntryId: string; parentId: string | null }> {
    const sourceEntry = await this.chatEntries.getChatEntry(conversationId, sourceEntryId);
    if (!sourceEntry) throw new Error(`source entry not found: ${sourceEntryId}`);
    if (sourceEntry.type === 'thought-prepare') {
      return { prepareEntryId: sourceEntry.id, parentId: sourceEntry.parentId };
    }
    if (sourceEntry.parentId) {
      const parent = await this.chatEntries.getChatEntry(conversationId, sourceEntry.parentId);
      if (parent?.type === 'thought-prepare') {
        return { prepareEntryId: parent.id, parentId: parent.parentId };
      }
    }
    throw new Error(`reprocess-context source ${sourceEntryId} is not a thought-prepare or its child`);
  }

  private async resolveProviderForPrepare(
    conversationId: string,
    prepareEntryId: string,
  ): Promise<AnyThoughtProvider> {
    const all = await this.chatEntries.listChatEntries(conversationId, { all: true });
    const streamChild = all.find((e) => e.parentId === prepareEntryId && isThoughtStreamEntry(e));
    if (!streamChild) {
      throw new Error(`thought-prepare ${prepareEntryId} has no stream child to identify provider`);
    }
    const provider = this.providers.find((p) => p.streamEntryType === streamChild.type);
    if (!provider) {
      throw new Error(`no provider registered for stream entry type ${streamChild.type}`);
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

  private async appendRunningActionEntry(
    ctx: ThoughtContext,
    provider: ThoughtTypeProvider<unknown>,
  ): Promise<string> {
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
