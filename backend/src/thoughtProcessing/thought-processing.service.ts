import { forwardRef, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { LifecycleScope } from '../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { LlmProviderSettingsRepo } from '../db/repositories/llm-provider-settings.repo.js';
import { parseEditedRequest, requestToDisplay } from '../llmProviders/messages.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../sse/sse-helpers.js';
import { AutoTitleThoughtTypeProvider } from './thoughtTypeProviders/autoTitleProvider.js';
import { CategorizeThoughtTypeProvider } from './thoughtTypeProviders/categorizeProvider.js';
import { GuardrailThoughtTypeProvider } from './thoughtTypeProviders/guardrailProvider.js';
import { PlannerThoughtTypeProvider } from './thoughtTypeProviders/plannerProvider.js';
import { SummarizeAttachmentThoughtTypeProvider } from './thoughtTypeProviders/summarizeAttachmentProvider.js';
import { SummarizeThoughtTypeProvider } from './thoughtTypeProviders/summarizeProvider.js';
import { ToolParamsThoughtTypeProvider } from './thoughtTypeProviders/toolParamsProvider.js';
import type { LlmCompletion } from '../llmProviders/types.js';
import {
  appendAtCursor,
  isThoughtStreamEntry,
  type LlmRef,
  type ThoughtContext,
  type ThoughtLane,
  type ThoughtStreamEntry,
  type ThoughtTypeProvider,
} from './types.js';
import { hydrateThoughtInput, serializeThoughtInput } from './inputSnapshot.js';
import { DecisionStep } from './steps/decisionStep.js';
import { PrepareStep, type PreparedReason } from './steps/prepareStep.js';
import { ReasonStep } from './steps/reasonStep.js';

type AnyThoughtProvider = ThoughtTypeProvider<any>;

@Injectable()
export class ThoughtProcessingService implements OnModuleInit {
  private readonly logger = new Logger(ThoughtProcessingService.name);
  private readonly providers: AnyThoughtProvider[];

  constructor(
    private readonly prepareStep: PrepareStep,
    private readonly reasonStep: ReasonStep,
    private readonly decisionStep: DecisionStep,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly hub: SseHubService,
    autoTitleProvider: AutoTitleThoughtTypeProvider,
    categorizeProvider: CategorizeThoughtTypeProvider,
    @Inject(forwardRef(() => PlannerThoughtTypeProvider))
    plannerProvider: PlannerThoughtTypeProvider,
    @Inject(forwardRef(() => ToolParamsThoughtTypeProvider))
    toolParamsProvider: ToolParamsThoughtTypeProvider,
    summarizeProvider: SummarizeThoughtTypeProvider,
    summarizeAttachmentProvider: SummarizeAttachmentThoughtTypeProvider,
    @Inject(forwardRef(() => GuardrailThoughtTypeProvider))
    guardrailProvider: GuardrailThoughtTypeProvider,
  ) {
    this.providers = [
      autoTitleProvider,
      categorizeProvider,
      plannerProvider,
      toolParamsProvider,
      summarizeProvider,
      summarizeAttachmentProvider,
      guardrailProvider,
    ];
  }

  /**
   * Boot sweep: a thought that was `running` when the process died can never
   * settle — the UI would spin forever and the turn looks stuck. Mark the
   * stranded prepare/stream/action entries cancelled with a visible reason;
   * the details panel's Retry (failed/cancelled streams) takes it from there.
   * Mirrors RunToolService's zombie tool sweep.
   */
  async onModuleInit(): Promise<void> {
    try {
      const zombies = await this.chatEntries.listRunningThoughtEntries();
      for (const zombie of zombies) {
        await this.chatEntries.mergeEntryPayload(zombie.conversationId, zombie.id, {
          status: 'cancelled',
          error: 'The backend restarted while this thought was running. Retry it from the details panel.',
        });
      }
      if (zombies.length > 0) {
        this.logger.warn(`boot sweep: ${zombies.length} thought entr(ies) stranded in running marked cancelled`);
      }
    } catch (error) {
      this.logger.error('thought boot sweep failed', error instanceof Error ? error.stack : String(error));
    }
  }

  /** Active LLM reference, resolved once per run and threaded into the start* methods. */
  async getLlmRef(): Promise<LlmRef> {
    const llmDoc = await this.llmProviderSettings.getDocument();
    return {
      providerId: llmDoc.llm_configuration.provider_id,
      model: llmDoc.llm_configuration.model_name,
    };
  }

  async getTitleLlmRef(): Promise<LlmRef> {
    const llmDoc = await this.llmProviderSettings.getDocument();
    const cfg = llmDoc.llm_configuration;
    if (cfg.title_provider_id && cfg.title_model_name) {
      return { providerId: cfg.title_provider_id, model: cfg.title_model_name };
    }
    return this.getLlmRef();
  }

  /**
   * Starts a thought at an explicit causal anchor.
   *
   * The caller states where the thought belongs from its own knowledge: the
   * user message it reacts to, the batch tail it continues from, the entry it
   * annotates. Spine thoughts extend the reply branch from the anchor; side
   * thoughts hang off the anchor without joining branch semantics, so any
   * number can run concurrently against the same anchor.
   *
   * `input` is optional: when omitted, `provider.buildInputFromConversation`
   * resolves it inside the spawned task (must be defined).
   */
  startThought<TInput>(args: {
    provider: ThoughtTypeProvider<TInput>;
    conversationId: string;
    scope: LifecycleScope;
    /** Entry the thought hangs off; null only for an empty conversation. */
    anchorParentId: string | null;
    lane: ThoughtLane;
    llm: LlmRef;
    input?: TInput;
  }): Promise<{ prepareEntryId: string }> {
    const { provider, conversationId, scope, anchorParentId, lane, llm } = args;
    scope.throwIfAborted();
    const buildInput = provider.buildInputFromConversation;
    if (args.input === undefined && !buildInput) {
      throw new Error(`provider ${provider.constructor.name} cannot self-initiate; pass input explicitly`);
    }
    const ctx = this.createContext(conversationId, llm, { cursorParentId: anchorParentId, lane });
    const prepareCreatePromise = this.appendPreparePlaceholder(ctx, provider);
    // Resolves once the prepare placeholder is persisted — the fan-in guard
    // awaits this so "a continuation already exists" is readable in the DB
    // before the next sibling checks. Failures surface through the spawned
    // task; fire-and-forget callers may ignore the returned promise.
    const prepareReady = prepareCreatePromise.then((p) => ({ prepareEntryId: p.id }));
    prepareReady.catch(() => undefined);
    scope.spawn(async () => {
      let input: TInput | undefined;
      try {
        const prepareEntry = await prepareCreatePromise;
        ctx.prepareEntryId = prepareEntry.id;
        input = args.input ?? (await buildInput!(conversationId, prepareEntry.id));
        // Persist input on the prepare entry so reprocess-context can rebuild
        // it without any per-provider logic. Reprocess truncates the chain back
        // to this prepare's parent before re-running, so the snapshot reflects
        // the same chain state the provider originally saw.
        await this.chatEntries.mergeEntryPayload(conversationId, prepareEntry.id, {
          inputJson: serializeThoughtInput(input, prepareEntry.id),
        });
        await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, prepareEntry.id);
        const prepared = await this.prepareStep.run(provider, input, ctx, scope);
        const completion = await this.reasonStep.run(provider, input, ctx, prepared, scope);
        await this.decisionStep.run(provider, input, ctx, completion, scope);
      } finally {
        if (input !== undefined) provider.onThoughtSettled?.(input, ctx);
      }
    });
    return prepareReady;
  }

  private appendPreparePlaceholder(ctx: ThoughtContext, provider: AnyThoughtProvider): Promise<{ id: string }> {
    return appendAtCursor(ctx, (parentId, isSide) =>
      this.chatEntries.appendThoughtPrepareEntry(ctx.conversationId, {
        thoughtId: ctx.thoughtId,
        parentId,
        isSide,
        status: 'running',
        title: provider.prepareTitle,
        llm: ctx.llm,
      }),
    );
  }

  async startReprocessContext(
    args: {
      conversationId: string;
      sourceEntryId: string;
      editedRequestText?: string;
      llm?: LlmRef;
      /**
       * Whether an `llm` override propagates to downstream thoughts (the
       * post-tool planner continuation). Default true = behaves like a
       * user-message model override. False = "just this call": only this
       * thought runs on the override; the continuation reverts to the
       * thought's inherited model.
       */
      applyDownstream?: boolean;
    },
    scope: LifecycleScope,
  ): Promise<{ plannerEntryId: string; leafEntryId: string }> {
    scope.throwIfAborted();
    const branch = await this.resolvePrepareSource(args.conversationId, args.sourceEntryId);
    // The edit-the-prompt flow sends the (possibly edited) request text. A
    // model-only branch or a plain retry sends nothing — reuse the source
    // prepare entry's own stored request rather than round-tripping it.
    const sourceText = (args.editedRequestText ?? '').trim() || (branch.requestText ?? '').trim();
    if (!sourceText) {
      throw new Error(
        `cannot reprocess: no edited request supplied and prepare entry ${branch.prepareEntryId} has no stored request`,
      );
    }
    // Parse eagerly so a malformed edit fails the API call before we mutate the chain.
    const request = parseEditedRequest(sourceText);
    const display = requestToDisplay(request);
    const provider = await this.resolveProviderForThought(args.conversationId, branch.thoughtId);
    if (branch.inputJson === null) {
      throw new Error(
        `cannot reprocess: prepare entry ${branch.prepareEntryId} has no persisted input ` +
          `(predates input-snapshot persistence)`,
      );
    }
    // The caller can override the LLM (model picker in the prepare-step editor);
    // otherwise reuse the source prepare entry's own LLM.
    const llm = args.llm ?? branch.llm;
    if (!llm) {
      throw new Error(
        `cannot reprocess: no LLM ref — prepare entry ${branch.prepareEntryId} has none persisted ` +
          `and none was supplied`,
      );
    }
    // The reprocessed thought is a sibling of the source: it anchors at the
    // source prepare's own parent, in the source's lane.
    const ctx = this.createContext(args.conversationId, llm, {
      cursorParentId: branch.parentId,
      lane: branch.isSide ? 'side' : 'spine',
    });
    // "Just this call": this thought runs on the override `llm`, but the
    // downstream continuation reverts to the thought's inherited model. When
    // applyDownstream (default), downstreamLlm stays equal to `llm`.
    if (args.applyDownstream === false && branch.llm) {
      ctx.downstreamLlm = branch.llm;
    }
    ctx.prepareEntryId = await this.appendCompletedPrepareEntry(ctx, provider, display, branch.inputJson);
    ctx.streamEntryId = await this.appendRunningStreamEntry(ctx, provider, display);
    const plannerEntryId = ctx.streamEntryId;
    await this.chatEntries.setDefaultViewLeaf(args.conversationId, plannerEntryId);

    scope.spawn(async () => {
      const input = await hydrateThoughtInput(this.chatEntries, branch.inputJson!);
      const prepared: PreparedReason = { request, display };
      const completion = await this.reasonStep.run(provider, input, ctx, prepared, scope);
      await this.decisionStep.run(provider, input, ctx, completion, scope);
    });
    return { plannerEntryId, leafEntryId: plannerEntryId };
  }

  async startReprocessReason(
    args: { conversationId: string; sourceEntryId: string; editedResponse: string },
    scope: LifecycleScope,
    llm: LlmRef,
  ): Promise<{ plannerEntryId: string; leafEntryId: string }> {
    scope.throwIfAborted();
    const editedResponse = args.editedResponse.trim();
    if (!editedResponse) throw new Error('editedResponse is required');
    const source = await this.resolveStreamSource(args.conversationId, args.sourceEntryId);
    const provider = source.provider;
    if (!provider.buildInputFromConversation) {
      throw new Error(`provider ${provider.constructor.name} cannot build input from conversation`);
    }
    // The edited reason branches at the source's prepare entry: the new
    // stream+action are siblings of the original stream, same lane.
    const ctx = this.createContext(args.conversationId, source.llm ?? llm, {
      thoughtId: source.thoughtId,
      cursorParentId: source.prepareEntryId,
      lane: source.isSide ? 'side' : 'spine',
    });
    ctx.prepareEntryId = source.prepareEntryId;
    ctx.streamEntryId = await this.appendCompletedStreamEntry(ctx, provider, source.llmRequest, editedResponse);
    ctx.thoughtActionEntryId = await this.appendRunningActionEntry(ctx, provider);
    const plannerEntryId = ctx.streamEntryId;
    const leafEntryId = ctx.thoughtActionEntryId!;
    await this.chatEntries.setDefaultViewLeaf(args.conversationId, leafEntryId);

    scope.spawn(async () => {
      const input = await provider.buildInputFromConversation!(args.conversationId, leafEntryId);
      const completion: LlmCompletion = {
        parts: [{ kind: 'text', text: editedResponse }],
        finishReason: 'stop',
      };
      await this.decisionStep.run(provider, input, ctx, completion, scope);
    });
    return { plannerEntryId, leafEntryId };
  }

  private createContext(
    conversationId: string,
    llm: LlmRef,
    opts: { thoughtId?: string; cursorParentId: string | null; lane: ThoughtLane },
  ): ThoughtContext {
    return {
      thoughtId: opts.thoughtId ?? crypto.randomUUID(),
      conversationId,
      llm,
      // Defaults to `llm`; reprocess can override it for "just this call".
      downstreamLlm: llm,
      prepareEntryId: null,
      streamEntryId: null,
      thoughtActionEntryId: null,
      cursorParentId: opts.cursorParentId,
      lane: opts.lane,
    };
  }

  private async resolvePrepareSource(
    conversationId: string,
    sourceEntryId: string,
  ): Promise<{
    prepareEntryId: string;
    parentId: string | null;
    isSide: boolean;
    thoughtId: string;
    inputJson: string | null;
    requestText: string | null;
    llm: LlmRef | null;
  }> {
    const sourceEntry = await this.chatEntries.getChatEntry(conversationId, sourceEntryId);
    if (!sourceEntry) throw new Error(`source entry not found: ${sourceEntryId}`);
    if (sourceEntry.type !== 'thought-prepare') {
      throw new Error(`reprocess-context source ${sourceEntryId} is not a thought-prepare (got ${sourceEntry.type})`);
    }
    return {
      prepareEntryId: sourceEntry.id,
      parentId: sourceEntry.parentId,
      isSide: sourceEntry.isSide,
      thoughtId: sourceEntry.thoughtId,
      inputJson: sourceEntry.inputJson ?? null,
      requestText: sourceEntry.requestText ?? null,
      llm: sourceEntry.llm ?? null,
    };
  }

  /**
   * Provider for a thought is identified by the stream entry's type, looked
   * up by `thoughtId` (robust against historical chains where another
   * thought's entry was interleaved between prepare and stream).
   */
  private async resolveProviderForThought(conversationId: string, thoughtId: string): Promise<AnyThoughtProvider> {
    const all = await this.chatEntries.listChatEntries(conversationId, { all: true });
    const streamEntry = all.find(
      (e): e is ThoughtStreamEntry => isThoughtStreamEntry(e) && e.thoughtId === thoughtId,
    );
    if (!streamEntry) {
      throw new Error(`thought ${thoughtId} has no stream entry to identify provider`);
    }
    const provider = this.providers.find((p) => p.thoughtType === streamEntry.thoughtType);
    if (!provider) {
      throw new Error(`no provider registered for thoughtType ${streamEntry.thoughtType}`);
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
    isSide: boolean;
    llmRequest: string;
    llm?: LlmRef;
  }> {
    const source = await this.chatEntries.getChatEntry(conversationId, sourceEntryId);
    if (!source) throw new Error(`source entry not found: ${sourceEntryId}`);
    if (!isThoughtStreamEntry(source)) {
      throw new Error(`reprocess-reason source entry is not a stream entry: ${source.type}`);
    }
    const provider = this.providers.find((p) => p.thoughtType === source.thoughtType);
    if (!provider) {
      throw new Error(`no provider registered for thoughtType ${source.thoughtType}`);
    }
    if (!source.parentId) throw new Error(`${source.type} ${sourceEntryId} has no parent`);
    const out: {
      provider: AnyThoughtProvider;
      thoughtId: string;
      prepareEntryId: string;
      isSide: boolean;
      llmRequest: string;
      llm?: LlmRef;
    } = {
      provider,
      thoughtId: source.thoughtId,
      prepareEntryId: source.parentId,
      isSide: source.isSide,
      llmRequest: source.llmRequest,
    };
    if (source.llm) out.llm = source.llm;
    return out;
  }

  private async appendCompletedPrepareEntry(
    ctx: ThoughtContext,
    provider: AnyThoughtProvider,
    requestText: string,
    inputJson: string | null,
  ): Promise<string> {
    const created = await appendAtCursor(ctx, (parentId, isSide) =>
      this.chatEntries.appendThoughtPrepareEntry(ctx.conversationId, {
        thoughtId: ctx.thoughtId,
        parentId,
        isSide,
        status: 'completed',
        requestText,
        title: provider.prepareTitle,
        llm: ctx.llm,
      }),
    );
    if (inputJson !== null) {
      // Carry the input forward so the new prepare entry is itself reprocessable.
      await this.chatEntries.mergeEntryPayload(ctx.conversationId, created.id, { inputJson });
    }
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async appendRunningStreamEntry(
    ctx: ThoughtContext,
    provider: ThoughtTypeProvider<unknown>,
    llmRequest: string,
  ): Promise<string> {
    const created = await appendAtCursor(ctx, (parentId, isSide) =>
      this.chatEntries.appendThoughtStreamEntry(ctx.conversationId, {
        thoughtType: provider.thoughtType,
        thoughtId: ctx.thoughtId,
        parentId,
        isSide,
        status: 'running',
        llm: ctx.llm,
      }),
    );
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, created.id, { llmRequest });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async appendRunningActionEntry(ctx: ThoughtContext, provider: ThoughtTypeProvider<unknown>): Promise<string> {
    const created = await appendAtCursor(ctx, (parentId, isSide) =>
      this.chatEntries.appendThoughtActionEntry(ctx.conversationId, {
        thoughtId: ctx.thoughtId,
        parentId,
        isSide,
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
    const created = await appendAtCursor(ctx, (parentId, isSide) =>
      this.chatEntries.appendThoughtStreamEntry(ctx.conversationId, {
        thoughtType: provider.thoughtType,
        thoughtId: ctx.thoughtId,
        parentId,
        isSide,
        status: 'completed',
        llm: ctx.llm,
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
