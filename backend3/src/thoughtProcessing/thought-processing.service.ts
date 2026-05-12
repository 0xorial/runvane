import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { LifecycleScope } from '../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { LlmProviderSettingsRepo } from '../db/repositories/llm-provider-settings.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../sse/sse-helpers.js';
import { AutoTitleThoughtTypeProvider } from './thoughtTypeProviders/autoTitleProvider.js';
import { PlannerThoughtTypeProvider } from './thoughtTypeProviders/plannerProvider.js';
import { ToolParamsThoughtTypeProvider } from './thoughtTypeProviders/toolParamsProvider.js';
import type {
  PreparedReason,
  ThoughtContext,
  ThoughtReasonLlmResult,
  ThoughtType,
  ThoughtTypeProvider,
} from './types.js';
import { DecisionStep } from './steps/decisionStep.js';
import { PrepareStep } from './steps/prepareStep.js';
import { ReasonStep } from './steps/reasonStep.js';

type AnyThoughtProvider = ThoughtTypeProvider<any>;

@Injectable()
export class ThoughtProcessingService {
  private readonly providers: Record<ThoughtType, AnyThoughtProvider>;

  constructor(
    private readonly prepareStep: PrepareStep,
    private readonly reasonStep: ReasonStep,
    private readonly decisionStep: DecisionStep,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly hub: SseHubService,
    private readonly autoTitleProvider: AutoTitleThoughtTypeProvider,
    @Inject(forwardRef(() => PlannerThoughtTypeProvider))
    private readonly plannerProvider: PlannerThoughtTypeProvider,
    private readonly toolParamsProvider: ToolParamsThoughtTypeProvider,
  ) {
    this.providers = {
      autoTitle: this.autoTitleProvider,
      planner: this.plannerProvider,
      toolParams: this.toolParamsProvider,
    };
  }

  startFullThought<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    scope: LifecycleScope,
  ): void {
    scope.throwIfAborted();
    const conversationId = (input as { conversationId?: unknown }).conversationId;
    if (typeof conversationId !== 'string' || !conversationId) {
      throw new Error('startFullThought requires input.conversationId');
    }
    scope.spawn(async () => {
      const ctx = await this.createContext(conversationId);
      const prepared = await this.prepareStep.run(provider, input, ctx, scope);
      const llmResult = await this.reasonStep.run(provider, input, ctx, prepared, scope);
      await this.decisionStep.run(provider, input, ctx, llmResult, scope);
    });
  }

  startFullThoughtByType(
    conversationId: string,
    thoughtType: ThoughtType,
    scope: LifecycleScope,
  ): void {
    const provider = this.providers[thoughtType];
    if (!provider.buildInputFromConversation) {
      throw new Error(`provider ${thoughtType} cannot self-initiate`);
    }
    scope.throwIfAborted();
    scope.spawn(async () => {
      const input = await provider.buildInputFromConversation!(conversationId);
      const ctx = await this.createContext(conversationId);
      const prepared = await this.prepareStep.run(provider, input, ctx, scope);
      const llmResult = await this.reasonStep.run(provider, input, ctx, prepared, scope);
      await this.decisionStep.run(provider, input, ctx, llmResult, scope);
    });
  }

  async startReprocessContext(
    args: { conversationId: string; sourceEntryId: string; editedRequestText: string },
    scope: LifecycleScope,
  ): Promise<{ plannerEntryId: string }> {
    scope.throwIfAborted();
    const editedRequestText = args.editedRequestText.trim();
    if (!editedRequestText) throw new Error('editedRequestText is required');
    const branchParentId = await this.resolveBranchedPrepareParentId(args.conversationId, args.sourceEntryId);
    if (!this.plannerProvider.buildInputFromConversation) {
      throw new Error('plannerProvider cannot build input from conversation');
    }

    const ctx = await this.createContext(args.conversationId);
    ctx.prepareEntryId = await this.appendCompletedPrepareEntry(ctx, branchParentId, editedRequestText);
    ctx.streamEntryId = await this.appendRunningStreamEntry(ctx, this.plannerProvider, editedRequestText);
    const plannerEntryId = ctx.streamEntryId;

    scope.spawn(async () => {
      const input = await this.plannerProvider.buildInputFromConversation!(args.conversationId);
      const prepared: PreparedReason = { prompt: editedRequestText };
      const llmResult = await this.reasonStep.run(this.plannerProvider, input, ctx, prepared, scope);
      await this.decisionStep.run(this.plannerProvider, input, ctx, llmResult, scope);
    });
    return { plannerEntryId };
  }

  async startReprocessReason(
    args: { conversationId: string; sourceEntryId: string; editedResponse: string },
    scope: LifecycleScope,
  ): Promise<{ plannerEntryId: string }> {
    scope.throwIfAborted();
    const editedResponse = args.editedResponse.trim();
    if (!editedResponse) throw new Error('editedResponse is required');
    const source = await this.resolvePlannerStreamSource(args.conversationId, args.sourceEntryId);
    if (!this.plannerProvider.buildInputFromConversation) {
      throw new Error('plannerProvider cannot build input from conversation');
    }

    const ctx = await this.createContext(args.conversationId, { thoughtId: source.thoughtId });
    if (source.llmProviderId) ctx.llmProviderId = source.llmProviderId;
    if (source.llmModel) ctx.llmModel = source.llmModel;
    ctx.prepareEntryId = source.prepareEntryId;
    ctx.streamEntryId = await this.appendCompletedStreamEntry(ctx, source.prepareEntryId, source.llmRequest, editedResponse);
    ctx.thoughtActionEntryId = await this.appendRunningActionEntry(ctx, this.plannerProvider);
    const plannerEntryId = ctx.streamEntryId;

    scope.spawn(async () => {
      const input = await this.plannerProvider.buildInputFromConversation!(args.conversationId);
      const llmResult: ThoughtReasonLlmResult = { fullResponse: editedResponse };
      if (source.llmProviderId) llmResult.providerId = source.llmProviderId;
      if (source.llmModel) llmResult.model = source.llmModel;
      await this.decisionStep.run(this.plannerProvider, input, ctx, llmResult, scope);
    });
    return { plannerEntryId };
  }

  private async createContext(
    conversationId: string,
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
    };
  }

  private async resolveBranchedPrepareParentId(conversationId: string, sourceEntryId: string): Promise<string | null> {
    const sourceEntry = await this.chatEntries.getChatEntry(conversationId, sourceEntryId);
    if (!sourceEntry) throw new Error(`source entry not found: ${sourceEntryId}`);
    if (sourceEntry.type === 'thought-prepare') return sourceEntry.parentId;
    if (!sourceEntry.parentId) return null;
    const parent = await this.chatEntries.getChatEntry(conversationId, sourceEntry.parentId);
    if (parent?.type === 'thought-prepare') return parent.parentId;
    return sourceEntry.parentId;
  }

  private async resolvePlannerStreamSource(
    conversationId: string,
    sourceEntryId: string,
  ): Promise<{
    thoughtId: string;
    prepareEntryId: string;
    llmRequest: string;
    llmProviderId?: string;
    llmModel?: string;
  }> {
    const source = await this.chatEntries.getChatEntry(conversationId, sourceEntryId);
    if (!source) throw new Error(`source entry not found: ${sourceEntryId}`);
    if (source.type !== 'planner_llm_stream') {
      throw new Error(`reprocess-reason requires a planner_llm_stream source, got ${source.type}`);
    }
    if (!source.parentId) throw new Error(`planner_llm_stream ${sourceEntryId} has no parent`);
    const out: {
      thoughtId: string;
      prepareEntryId: string;
      llmRequest: string;
      llmProviderId?: string;
      llmModel?: string;
    } = {
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
    parentId: string | null,
    requestText: string,
  ): Promise<string> {
    const created = await this.chatEntries.appendThoughtPrepareEntry(ctx.conversationId, {
      thoughtId: ctx.thoughtId,
      parentId,
      status: 'completed',
      requestText,
      title: this.plannerProvider.prepareTitle,
      llmProviderId: ctx.llmProviderId,
      llmModel: ctx.llmModel,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async appendRunningStreamEntry(
    ctx: ThoughtContext,
    provider: ThoughtTypeProvider<unknown>,
    llmRequest: string,
  ): Promise<string> {
    const created = await this.chatEntries.appendThoughtStreamEntry(ctx.conversationId, {
      type: provider.streamKind === 'title' ? 'title_llm_stream' : 'planner_llm_stream',
      thoughtId: ctx.thoughtId,
      status: 'running',
      llmProviderId: ctx.llmProviderId,
      llmModel: ctx.llmModel,
    });
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, created.id, { llmRequest });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async appendRunningActionEntry(
    ctx: ThoughtContext,
    provider: ThoughtTypeProvider<unknown>,
  ): Promise<string> {
    const created = await this.chatEntries.appendThoughtActionEntry(ctx.conversationId, {
      thoughtId: ctx.thoughtId,
      status: 'running',
      summary: provider.initialActionSummary ?? 'Waiting for LLM output',
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async appendCompletedStreamEntry(
    ctx: ThoughtContext,
    parentId: string,
    llmRequest: string,
    llmResponse: string,
  ): Promise<string> {
    const created = await this.chatEntries.appendThoughtStreamEntry(ctx.conversationId, {
      type: 'planner_llm_stream',
      thoughtId: ctx.thoughtId,
      parentId,
      status: 'completed',
      llmProviderId: ctx.llmProviderId,
      llmModel: ctx.llmModel,
    });
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, created.id, {
      llmRequest,
      llmResponse,
      thoughtMs: 0,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

}
