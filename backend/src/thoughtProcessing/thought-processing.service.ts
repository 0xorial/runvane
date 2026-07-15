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
import { KnowledgePlanningThoughtTypeProvider } from './thoughtTypeProviders/knowledgePlanningProvider.js';
import { SummarizeAttachmentThoughtTypeProvider } from './thoughtTypeProviders/summarizeAttachmentProvider.js';
import { SummarizeThoughtTypeProvider } from './thoughtTypeProviders/summarizeProvider.js';
import { ToolParamsThoughtTypeProvider } from './thoughtTypeProviders/toolParamsProvider.js';
import type { LlmCompletion } from '../llmProviders/types.js';
import type { ThoughtEntry, ThoughtType } from '../contracts/chatEntry.js';
import {
  appendAtCursor,
  isThoughtEntry,
  type LlmRef,
  type ThoughtContext,
  type ThoughtLane,
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
    @Inject(forwardRef(() => KnowledgePlanningThoughtTypeProvider))
    knowledgePlanningProvider: KnowledgePlanningThoughtTypeProvider,
  ) {
    this.providers = [
      autoTitleProvider,
      categorizeProvider,
      plannerProvider,
      toolParamsProvider,
      summarizeProvider,
      summarizeAttachmentProvider,
      guardrailProvider,
      knowledgePlanningProvider,
    ];
  }

  /**
   * Boot sweep: a thought that was `running` when the process died can never
   * settle — the UI would spin forever and the turn looks stuck. Mark the
   * stranded thought entries cancelled with a visible reason; the details
   * panel's Retry (failed/cancelled thoughts) takes it from there. Mirrors
   * RunToolService's zombie tool sweep.
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
   * resolves it inside the spawned task (must be defined). Providers whose
   * thoughtType has mapper-required extra fields (`thoughtEntryExtraPayload`)
   * must pass `input` up front so the initial insert is schema-complete —
   * `assertServableRow` trips immediately otherwise.
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
  }): Promise<{ thoughtEntryId: string }> {
    const { provider, conversationId, scope, anchorParentId, lane, llm } = args;
    scope.throwIfAborted();
    const buildInput = provider.buildInputFromConversation;
    if (args.input === undefined && !buildInput) {
      throw new Error(`provider ${provider.constructor.name} cannot self-initiate; pass input explicitly`);
    }
    const ctx = this.createContext(conversationId, llm, { cursorParentId: anchorParentId, lane });
    const extra = args.input !== undefined ? provider.thoughtEntryExtraPayload?.(args.input) : undefined;
    const thoughtCreatePromise = appendAtCursor(ctx, (parentId, isSide) =>
      this.chatEntries.appendThoughtEntry(ctx.conversationId, {
        thoughtType: provider.thoughtType,
        parentId,
        isSide,
        stage: 'prepare',
        status: 'running',
        title: provider.prepareTitle,
        llm: ctx.llm,
        ...(provider.initialActionSummary ? { summary: provider.initialActionSummary } : {}),
        extra: extra ?? undefined,
      }),
    );
    // Resolves once the thought entry is persisted — the fan-in guard awaits
    // this so "a continuation already exists" is readable in the DB before
    // the next sibling checks. Failures surface through the spawned task;
    // fire-and-forget callers may ignore the returned promise.
    const thoughtReady = thoughtCreatePromise.then((t) => ({ thoughtEntryId: t.id }));
    thoughtReady.catch(() => undefined);
    scope.spawn(async () => {
      let input: TInput | undefined;
      try {
        const thoughtEntry = await thoughtCreatePromise;
        ctx.thoughtEntryId = thoughtEntry.id;
        input = args.input ?? (await buildInput!(conversationId, thoughtEntry.id));
        // Persist input on the thought entry so reprocess-context can rebuild
        // it without any per-provider logic. Reprocess truncates the chain back
        // to this thought's parent before re-running, so the snapshot reflects
        // the same chain state the provider originally saw.
        await this.chatEntries.mergeEntryPayload(conversationId, thoughtEntry.id, {
          inputJson: serializeThoughtInput(input, thoughtEntry.id),
        });
        await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, thoughtEntry.id);
        const prepared = await this.prepareStep.run(provider, input, ctx, scope);
        const completion = await this.reasonStep.run(provider, input, ctx, prepared, scope);
        await this.decisionStep.run(provider, input, ctx, completion, scope);
      } finally {
        if (input !== undefined) provider.onThoughtSettled?.(input, ctx);
      }
    });
    return thoughtReady;
  }

  /**
   * Fork a thought at its context: a sibling thought whose request is the
   * edited text (or the source's request verbatim for a model-only retry);
   * reason + decision run fresh. `forkPoint: 'context'` records what changed.
   */
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
    const source = await this.resolveThoughtSource(args.conversationId, args.sourceEntryId);
    // The edit-the-prompt flow sends the (possibly edited) request text. A
    // model-only branch or a plain retry sends nothing — reuse the source
    // thought's own stored request rather than round-tripping it.
    const sourceText = (args.editedRequestText ?? '').trim() || (source.llmRequest ?? '').trim();
    if (!sourceText) {
      throw new Error(`cannot reprocess: no edited request supplied and thought ${source.id} has no stored request`);
    }
    // Parse eagerly so a malformed edit fails the API call before we mutate the chain.
    const request = parseEditedRequest(sourceText);
    const display = requestToDisplay(request);
    const provider = this.providerFor(source.thoughtType);
    if (source.inputJson === undefined) {
      throw new Error(
        `cannot reprocess: thought ${source.id} has no persisted input (predates input-snapshot persistence)`,
      );
    }
    // The caller can override the LLM (model picker in the request editor);
    // otherwise reuse the source thought's own LLM.
    const llm = args.llm ?? source.llm;
    if (!llm) {
      throw new Error(`cannot reprocess: no LLM ref — thought ${source.id} has none persisted and none was supplied`);
    }
    // The fork is a sibling of the source: it anchors at the source thought's
    // own parent, in the source's lane.
    const ctx = this.createContext(args.conversationId, llm, {
      cursorParentId: source.parentId,
      lane: source.isSide ? 'side' : 'spine',
    });
    // "Just this call": this thought runs on the override `llm`, but the
    // downstream continuation reverts to the thought's inherited model. When
    // applyDownstream (default), downstreamLlm stays equal to `llm`.
    if (args.applyDownstream === false && source.llm) {
      ctx.downstreamLlm = source.llm;
    }
    const created = await appendAtCursor(ctx, (parentId, isSide) =>
      this.chatEntries.appendThoughtEntry(args.conversationId, {
        thoughtType: source.thoughtType,
        parentId,
        isSide,
        // Prepare already happened (the request text IS the prepared output).
        stage: 'reason',
        status: 'running',
        title: source.title ?? provider.prepareTitle,
        llm,
        llmRequest: display,
        forkOf: source.id,
        forkPoint: 'context',
        extra: carryThoughtTypeExtras(source),
      }),
    );
    ctx.thoughtEntryId = created.id;
    // Carry the input forward so the fork is itself reprocessable.
    await this.chatEntries.mergeEntryPayload(args.conversationId, created.id, { inputJson: source.inputJson });
    await publishChatEntryUpsert(this.hub, this.chatEntries, args.conversationId, created.id);
    await this.chatEntries.setDefaultViewLeaf(args.conversationId, created.id);

    const inputJson = source.inputJson;
    scope.spawn(async () => {
      const input = await hydrateThoughtInput(this.chatEntries, inputJson);
      const prepared: PreparedReason = { request, display };
      const completion = await this.reasonStep.run(provider, input, ctx, prepared, scope);
      await this.decisionStep.run(provider, input, ctx, completion, scope);
    });
    return { plannerEntryId: created.id, leafEntryId: created.id };
  }

  /**
   * Fork a thought at its reasoning: a sibling thought with the request
   * copied verbatim and the LLM response replaced by the edited text; only
   * the decision runs. `forkPoint: 'reason'` records what changed.
   */
  async startReprocessReason(
    args: { conversationId: string; sourceEntryId: string; editedResponse: string },
    scope: LifecycleScope,
    llm: LlmRef,
  ): Promise<{ plannerEntryId: string; leafEntryId: string }> {
    scope.throwIfAborted();
    const editedResponse = args.editedResponse.trim();
    if (!editedResponse) throw new Error('editedResponse is required');
    const source = await this.resolveThoughtSource(args.conversationId, args.sourceEntryId);
    const provider = this.providerFor(source.thoughtType);
    if (!provider.buildInputFromConversation) {
      throw new Error(`provider ${provider.constructor.name} cannot build input from conversation`);
    }
    if (!source.llmRequest) {
      throw new Error(`cannot reprocess: thought ${source.id} has no stored request to copy`);
    }
    const ctx = this.createContext(args.conversationId, source.llm ?? llm, {
      cursorParentId: source.parentId,
      lane: source.isSide ? 'side' : 'spine',
    });
    const created = await appendAtCursor(ctx, (parentId, isSide) =>
      this.chatEntries.appendThoughtEntry(args.conversationId, {
        thoughtType: source.thoughtType,
        parentId,
        isSide,
        // Request + response are both in hand; only the decision remains.
        stage: 'decide',
        status: 'running',
        title: source.title ?? provider.prepareTitle,
        llm: ctx.llm,
        llmRequest: source.llmRequest,
        llmResponse: editedResponse,
        thoughtMs: 0,
        forkOf: source.id,
        forkPoint: 'reason',
        extra: carryThoughtTypeExtras(source),
      }),
    );
    ctx.thoughtEntryId = created.id;
    if (source.inputJson !== undefined) {
      // Carry the input forward so the fork is itself context-reprocessable.
      await this.chatEntries.mergeEntryPayload(args.conversationId, created.id, { inputJson: source.inputJson });
    }
    await publishChatEntryUpsert(this.hub, this.chatEntries, args.conversationId, created.id);
    await this.chatEntries.setDefaultViewLeaf(args.conversationId, created.id);

    scope.spawn(async () => {
      const input = await provider.buildInputFromConversation!(args.conversationId, created.id);
      const completion: LlmCompletion = {
        parts: [{ kind: 'text', text: editedResponse }],
        finishReason: 'stop',
      };
      await this.decisionStep.run(provider, input, ctx, completion, scope);
    });
    return { plannerEntryId: created.id, leafEntryId: created.id };
  }

  private createContext(
    conversationId: string,
    llm: LlmRef,
    opts: { cursorParentId: string | null; lane: ThoughtLane },
  ): ThoughtContext {
    return {
      conversationId,
      llm,
      // Defaults to `llm`; reprocess can override it for "just this call".
      downstreamLlm: llm,
      thoughtEntryId: null,
      cursorParentId: opts.cursorParentId,
      lane: opts.lane,
    };
  }

  private async resolveThoughtSource(conversationId: string, sourceEntryId: string): Promise<ThoughtEntry> {
    const sourceEntry = await this.chatEntries.getChatEntry(conversationId, sourceEntryId);
    if (!sourceEntry) throw new Error(`source entry not found: ${sourceEntryId}`);
    if (!isThoughtEntry(sourceEntry)) {
      throw new Error(`reprocess source ${sourceEntryId} is not a thought (got ${sourceEntry.type})`);
    }
    return sourceEntry;
  }

  private providerFor(thoughtType: ThoughtType): AnyThoughtProvider {
    const provider = this.providers.find((p) => p.thoughtType === thoughtType);
    if (!provider) throw new Error(`no provider registered for thoughtType ${thoughtType}`);
    return provider;
  }
}

/**
 * Thought-type-specific fields a fork must copy from its source so the new
 * entry is schema-complete from its initial insert (the mapper requires them
 * for the thoughtType). Outputs of the re-run stages (e.g. `summaryText`) are
 * deliberately NOT carried — the fork produces its own.
 */
function carryThoughtTypeExtras(source: ThoughtEntry): Record<string, unknown> | undefined {
  if (source.thoughtType !== 'summarize_attachment') return undefined;
  return {
    attachmentId: source.attachmentId,
    userMessageId: source.userMessageId,
    ...(source.filename !== undefined ? { filename: source.filename } : {}),
    ...(source.mimeType !== undefined ? { mimeType: source.mimeType } : {}),
    ...(source.sizeBytes !== undefined ? { sizeBytes: source.sizeBytes } : {}),
  };
}
