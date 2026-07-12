import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SseType } from '../contracts/sse.js';
import { ContextInjectionService } from '../context-injection/context-injection.service.js';
import { AgentsRepo } from '../db/repositories/agents.repo.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { PendingMessagesRepo } from '../db/repositories/pending-messages.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated, publishChatEntryUpsert } from '../sse/sse-helpers.js';
import { createBatchBarrier } from '../thoughtProcessing/lib/batchBarrier.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import { AutoTitleThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/autoTitleProvider.js';
import { CategorizeThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/categorizeProvider.js';
import { PlannerThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/plannerProvider.js';
import { SummarizeAttachmentThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/summarizeAttachmentProvider.js';
import { SummarizeThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/summarizeProvider.js';
import type { ChatAttachment } from '../contracts/chatEntry.js';
import type { RagOverride, RetrievalQuery } from '../contracts/retrieval.js';
import type { LlmRef } from '../thoughtProcessing/types.js';
import { ForcedRetrievalService } from '../rag/retrieval/forced-retrieval.service.js';
import { RunToolService } from '../tools/run-tool.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { ConversationCategorizerService } from './conversation-categorizer.service.js';
import { PostConversationMessageDto } from './dto/post-conversation-message.dto.js';
import { LifecycleScope } from './lifecycle-scope.js';
import { resolveSummarizeRange } from './summarizeRange.js';

type ConversationRun = { scope: LifecycleScope };

/** True for AbortController/AbortSignal cancellations (expected, not failures). */
function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError'
  );
}

@Injectable()
export class ConversationProcessorService implements OnModuleInit {
  private readonly logger = new Logger(ConversationProcessorService.name);
  private readonly activeExecutions = new Map<string, LifecycleScope>();
  private readonly messagePostLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly thoughtProcessing: ThoughtProcessingService,
    private readonly conversations: ConversationsRepo,
    private readonly hub: SseHubService,
    private readonly autoTitleProvider: AutoTitleThoughtTypeProvider,
    private readonly categorizeProvider: CategorizeThoughtTypeProvider,
    private readonly plannerProvider: PlannerThoughtTypeProvider,
    private readonly summarizeProvider: SummarizeThoughtTypeProvider,
    private readonly summarizeAttachmentProvider: SummarizeAttachmentThoughtTypeProvider,
    private readonly uploads: UploadsService,
    private readonly agents: AgentsRepo,
    private readonly runTool: RunToolService,
    private readonly pendingMsgs: PendingMessagesRepo,
    private readonly categorizer: ConversationCategorizerService,
    private readonly contextInjection: ContextInjectionService,
    private readonly forcedRetrieval: ForcedRetrievalService,
  ) {}

  /**
   * Queued messages are durable (pending_messages) — a restart must not drop
   * text the user typed. Whatever the dead process left queued drains now,
   * through the normal drain path.
   */
  async onModuleInit(): Promise<void> {
    try {
      const conversationIds = await this.pendingMsgs.conversationIdsWithPending();
      for (const conversationId of conversationIds) {
        this.logger.warn(`boot: draining queued message(s) left by a previous process: conversation=${conversationId}`);
        void this.drainPendingMessages(conversationId);
      }
    } catch (error) {
      this.logger.error('boot drain of queued messages failed', error instanceof Error ? error.stack : String(error));
    }
  }

  async approveToolInvocation(args: {
    conversationId: string;
    toolEntryId: string;
    editedParameters?: Record<string, unknown>;
  }): Promise<void> {
    const entries = await this.chatEntries.listChatEntriesFromLeaf(args.conversationId, args.toolEntryId);
    const anchorUser = [...entries].reverse().find((e) => e.type === 'user-message');
    if (!anchorUser) throw new Error('conversation has no user message to resolve the agent from');
    const agentId = anchorUser.agentId;
    const llm = await this.resolveLlmRef({
      explicitProviderId: anchorUser.llm?.providerId,
      explicitModel: anchorUser.llm?.model,
      agentId,
    });
    const { scope } = await this.beginRun(args.conversationId, { joinActive: true });
    try {
      await this.runTool.approveAndRun(
        {
          conversationId: args.conversationId,
          toolEntryId: args.toolEntryId,
          agentId,
          ...(args.editedParameters !== undefined ? { editedParameters: args.editedParameters } : {}),
        },
        scope,
        llm,
      );
    } finally {
      scope.rootDone();
    }
  }

  async retryToolInvocation(args: { conversationId: string; toolEntryId: string }): Promise<void> {
    const entries = await this.chatEntries.listChatEntriesFromLeaf(args.conversationId, args.toolEntryId);
    const anchorUser = [...entries].reverse().find((e) => e.type === 'user-message');
    if (!anchorUser) throw new Error('conversation has no user message to resolve the agent from');
    const agentId = anchorUser.agentId;
    const llm = await this.resolveLlmRef({
      explicitProviderId: anchorUser.llm?.providerId,
      explicitModel: anchorUser.llm?.model,
      agentId,
    });
    const { scope } = await this.beginRun(args.conversationId, { joinActive: true });
    try {
      await this.runTool.retryToolInvocation(
        { conversationId: args.conversationId, toolEntryId: args.toolEntryId, agentId },
        scope,
        llm,
      );
    } finally {
      scope.rootDone();
    }
  }

  async denyToolInvocation(args: { conversationId: string; toolEntryId: string }): Promise<void> {
    const entries = await this.chatEntries.listChatEntriesFromLeaf(args.conversationId, args.toolEntryId);
    const anchorUser = [...entries].reverse().find((e) => e.type === 'user-message');
    if (!anchorUser) throw new Error('conversation has no user message to resolve the agent from');
    const agentId = anchorUser.agentId;
    const llm = await this.resolveLlmRef({
      explicitProviderId: anchorUser.llm?.providerId,
      explicitModel: anchorUser.llm?.model,
      agentId,
    });
    const { scope } = await this.beginRun(args.conversationId, { joinActive: true });
    try {
      await this.runTool.denyToolInvocation(
        { conversationId: args.conversationId, toolEntryId: args.toolEntryId, agentId },
        scope,
        llm,
      );
    } finally {
      scope.rootDone();
    }
  }

  private async resolveLlmRef(opts: {
    explicitProviderId?: string;
    explicitModel?: string;
    agentId?: string;
  }): Promise<LlmRef> {
    if (opts.explicitProviderId && opts.explicitModel) {
      return { providerId: opts.explicitProviderId, model: opts.explicitModel };
    }
    if (opts.agentId) {
      const agent = await this.agents.get(opts.agentId);
      if (agent) {
        const cfg = agent.default_llm_configuration;
        const ref = agent.model_reference;
        const providerId = String(cfg?.provider_id ?? ref?.provider_id ?? '').trim();
        const model = String(cfg?.model_name ?? ref?.model_name ?? '').trim();
        if (providerId && model) return { providerId, model };
      }
    }
    return this.thoughtProcessing.getLlmRef();
  }

  /**
   * Start a run scope for a conversation.
   *
   * By default a new run steers: it aborts and replaces any active run. Pass
   * `joinActive` for approve/deny of a fanned-out tool — those must NOT disturb
   * sibling tools still executing in the original run, so when a run is already
   * active we leave it registered and run alongside it. The durable, DB-derived
   * fan-in coordinator ties the scopes together and continues the planner
   * once, whichever scope resolves the final tool.
   */
  private async beginRun(conversationId: string, opts: { joinActive?: boolean } = {}): Promise<ConversationRun> {
    const prev = this.activeExecutions.get(conversationId);
    if (prev && !opts.joinActive) {
      prev.abort();
      await prev.whenFinished();
    }
    const scope = new LifecycleScope(
      () => {
        if (this.activeExecutions.get(conversationId) === scope) {
          this.activeExecutions.delete(conversationId);
        }
        // A run just finished — release the next queued message, if any.
        void this.drainPendingMessages(conversationId);
      },
      (error) => {
        // Aborts are expected control flow (steer / cancel tore down the run),
        // not failures — don't log them as errors.
        if (isAbortError(error)) {
          this.logger.debug(`lifecycle scope task aborted: conversation=${conversationId}`);
          return;
        }
        this.logger.error(
          `lifecycle scope task failed: conversation=${conversationId}`,
          error instanceof Error ? error.stack : String(error),
        );
      },
    );
    // When joining an already-active run, leave it registered so steering and
    // `isProcessing` still track the original turn; otherwise this run owns the
    // slot. (If nothing is active, a joining run registers normally.)
    if (!(opts.joinActive && prev)) {
      this.activeExecutions.set(conversationId, scope);
    }
    return { scope };
  }

  cancelProcessing(conversationId: string): number {
    const scope = this.activeExecutions.get(conversationId);
    if (!scope) return 0;
    scope.abort();
    return 1;
  }

  /** Snapshot of queued (not-yet-posted) messages for a conversation. */
  async listPendingMessages(conversationId: string): Promise<Array<{ clientRequestId: string; text: string }>> {
    const queue = await this.pendingMsgs.list(conversationId);
    return queue
      .filter((m): m is { clientRequestId: string; dto: PostConversationMessageDto } => Boolean(m.clientRequestId))
      .map((m) => ({ clientRequestId: m.clientRequestId, text: m.dto.message }));
  }

  /** Remove a queued message before it drains. Returns true if one was removed. */
  async cancelPendingMessage(conversationId: string, clientRequestId: string): Promise<boolean> {
    const removed = await this.pendingMsgs.removeByClientRequestId(conversationId, clientRequestId);
    if (!removed) return false;
    this.hub.publish(conversationId, { type: SseType.MESSAGE_DEQUEUED, clientRequestId });
    return true;
  }

  /**
   * Post the next queued message after a run completes. Re-anchors to the
   * conversation's live leaf — while the message waited, the finished run
   * advanced the tip, so the captured parent is stale. Re-entrant: the drained
   * message's own completion drains the one after it, in FIFO order.
   */
  private async drainPendingMessages(conversationId: string): Promise<void> {
    if (this.isProcessing(conversationId)) return;
    const next = await this.pendingMsgs.shiftOldest(conversationId);
    if (!next) return;

    if (next.clientRequestId) {
      this.hub.publish(conversationId, {
        type: SseType.MESSAGE_DEQUEUED,
        clientRequestId: next.clientRequestId,
      });
    }

    const entries = await this.chatEntries.listChatEntries(conversationId);
    const tipId = entries.length > 0 ? entries[entries.length - 1].id : null;
    const drained = { ...next, parentId: tipId, enqueue: false, steer: false } as PostConversationMessageDto;

    try {
      await this.processMessage(conversationId, drained);
    } catch (error) {
      this.logger.error(
        `failed to drain queued message: conversation=${conversationId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async startReprocessContext(args: {
    conversationId: string;
    sourceEntryId: string;
    editedRequestText?: string;
    llm?: LlmRef;
    applyDownstream?: boolean;
  }): Promise<{ plannerEntryId: string; leafEntryId: string }> {
    const { scope } = await this.beginRun(args.conversationId);
    try {
      const result = await this.thoughtProcessing.startReprocessContext(args, scope);
      await publishConversationUpdated(this.hub, this.conversations, this.chatEntries, args.conversationId);
      return result;
    } finally {
      scope.rootDone();
    }
  }

  async startReprocessReason(args: {
    conversationId: string;
    sourceEntryId: string;
    editedResponse: string;
  }): Promise<{ plannerEntryId: string; leafEntryId: string }> {
    const { scope } = await this.beginRun(args.conversationId);
    try {
      const llm = await this.thoughtProcessing.getLlmRef();
      const result = await this.thoughtProcessing.startReprocessReason(args, scope, llm);
      await publishConversationUpdated(this.hub, this.conversations, this.chatEntries, args.conversationId);
      return result;
    } finally {
      scope.rootDone();
    }
  }

  async reprocessUserMessage(args: {
    conversationId: string;
    sourceEntryId: string;
    editedText: string;
  }): Promise<{ userMessageEntryId: string; leafEntryId: string }> {
    const source = await this.chatEntries.getChatEntry(args.conversationId, args.sourceEntryId);
    if (!source) throw new Error(`source entry not found: ${args.sourceEntryId}`);
    if (source.type !== 'user-message') {
      throw new Error(`reprocess target ${args.sourceEntryId} is not a user-message: ${source.type}`);
    }

    const { scope } = await this.beginRun(args.conversationId);
    try {
      const llm = await this.resolveLlmRef({
        explicitProviderId: source.llm?.providerId,
        explicitModel: source.llm?.model,
        agentId: source.agentId,
      });
      const sibling = await this.chatEntries.appendUserMessage(args.conversationId, {
        text: args.editedText,
        agentId: source.agentId,
        ...(source.llm ? { llm: source.llm } : {}),
        ...(source.modelPresetId != null ? { modelPresetId: source.modelPresetId } : {}),
        parentId: source.parentId,
        ...(source.attachments && source.attachments.length > 0 ? { attachments: source.attachments } : {}),
        ...(source.overrides ? { overrides: source.overrides } : {}),
      });
      await this.chatEntries.setDefaultViewLeaf(args.conversationId, sibling.id);
      const siblingPayload = await this.chatEntries.getChatEntry(args.conversationId, sibling.id);
      if (!siblingPayload || siblingPayload.type !== 'user-message') {
        throw new Error(`appended user-message ${sibling.id} not retrievable as user-message`);
      }
      await publishConversationUpdated(this.hub, this.conversations, this.chatEntries, args.conversationId);
      this.hub.publish(args.conversationId, { type: SseType.USER_MESSAGE, entry: siblingPayload });

      void this.thoughtProcessing.startThought({
        provider: this.plannerProvider,
        conversationId: args.conversationId,
        scope,
        anchorParentId: sibling.id,
        lane: 'spine',
        llm,
      });
      return { userMessageEntryId: sibling.id, leafEntryId: sibling.id };
    } finally {
      scope.rootDone();
    }
  }

  async startSummarize(args: { conversationId: string; firstEntryToSummarize: string }): Promise<void> {
    const activeChain = await this.chatEntries.listChatEntries(args.conversationId);
    if (activeChain.length === 0) throw new Error('conversation has no entries to summarize');

    const range = resolveSummarizeRange(activeChain, args.firstEntryToSummarize);
    const summarizeAgentId = range.rangeEntries.find((e) => e.type === 'user-message')?.agentId;

    const { scope } = await this.beginRun(args.conversationId);
    try {
      const llm = await this.resolveLlmRef({ agentId: summarizeAgentId });
      // Anchor the new branch at the parent of `firstEntryToSummarize` so the
      // prepare / stream / checkpoint-summary entries become a sibling of the
      // original tail. The original tail stays reachable via the branch
      // selector on the resulting summary entry.
      void this.thoughtProcessing.startThought({
        provider: this.summarizeProvider,
        conversationId: args.conversationId,
        scope,
        anchorParentId: range.fromParentId,
        lane: 'spine',
        llm,
        input: {
          conversationId: args.conversationId,
          fromEntryId: range.fromEntryId,
          toEntryId: range.toEntryId,
          rangeEntries: range.rangeEntries,
          rangeEntryCount: range.rangeEntryCount,
        },
      });
    } finally {
      scope.rootDone();
    }
  }

  /**
   * Re-run categorization as a standalone side thought after a pinned chat is
   * unlocked. Fire-and-forget. Side thoughts hang off their anchor without
   * joining branch semantics, so this can never fork the conversation or move
   * the user's view — it just renders at the branch leaf it annotates.
   */
  recategorizeInBackground(conversationId: string): void {
    void this.recategorize(conversationId).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`recategorize ${conversationId} failed: ${detail}`);
    });
  }

  private async recategorize(conversationId: string): Promise<void> {
    if (!(await this.categorizer.shouldCategorize(conversationId))) return;
    const titleLlm = await this.thoughtProcessing.getTitleLlmRef();
    // The stored anchor is only the user's branch choice — walk to the branch's
    // real leaf (the raw value goes stale the moment a run appends past it).
    const leaf = await this.chatEntries.resolveDefaultViewLeaf(conversationId);

    const { scope } = await this.beginRun(conversationId);
    try {
      void this.thoughtProcessing.startThought({
        provider: this.categorizeProvider,
        conversationId,
        scope,
        anchorParentId: leaf,
        lane: 'side',
        llm: titleLlm,
      });
    } finally {
      scope.rootDone();
    }
  }

  isProcessing(conversationId: string): boolean {
    return this.activeExecutions.has(conversationId);
  }

  async processMessage(conversationId: string, body: PostConversationMessageDto): Promise<void> {
    // Enqueue: if a run is in flight, hold the message and let the active
    // scope's completion drain it (with a freshly-resolved parent). When
    // nothing is running, fall through and post immediately.
    if (body.enqueue && !body.steer && this.isProcessing(conversationId)) {
      await this.pendingMsgs.enqueue(conversationId, body);
      if (body.clientRequestId) {
        this.hub.publish(conversationId, {
          type: SseType.MESSAGE_ENQUEUED,
          clientRequestId: body.clientRequestId,
          text: body.message,
        });
      }
      return;
    }
    return this.withMessagePostLock(conversationId, Boolean(body.steer), async () => {
      const { scope } = await this.beginRun(conversationId);
      try {
        const llm = await this.resolveLlmRef({
          explicitProviderId: body.llm?.providerId,
          explicitModel: body.llm?.model,
          agentId: body.agentId,
        });
        const titleLlm = await this.thoughtProcessing.getTitleLlmRef();
        const existingMessages = await this.chatEntries.listMessages(conversationId);
        if (existingMessages.length > 0 && !body.parentId) {
          throw new Error('parentId is required when conversation already has messages');
        }
        const parentId = body.parentId ?? null;
        const attachments = body.attachments && body.attachments.length > 0
          ? await this.uploads.resolveChatAttachments(body.attachments)
          : undefined;
        const userEntry = await this.chatEntries.appendUserMessage(conversationId, {
          text: body.message,
          agentId: body.agentId,
          ...(body.llm ? { llm: body.llm } : {}),
          modelPresetId: body.modelPresetId,
          parentId,
          ...(attachments ? { attachments } : {}),
          ...(body.overrides ? { overrides: body.overrides } : {}),
        });
        await this.chatEntries.setDefaultViewLeaf(conversationId, userEntry.id);
        const userPayload = await this.chatEntries.getChatEntry(conversationId, userEntry.id);
        if (!userPayload || userPayload.type !== 'user-message') {
          throw new Error(`appended user-message ${userEntry.id} not retrievable as user-message`);
        }
        await publishConversationUpdated(this.hub, this.conversations, this.chatEntries, conversationId);
        this.hub.publish(conversationId, {
          type: SseType.USER_MESSAGE,
          entry: userPayload,
          ...(body.clientRequestId ? { clientRequestId: body.clientRequestId } : {}),
        });

        const isFirstMessage = existingMessages.length === 0;
        // Awaited (unlike the fire-and-forget thoughts below): the planner's
        // first `buildInputFromConversation` read must already see this entry
        // in the chain, and there's no LLM call here to run concurrently with.
        // The context-injection entry (when created) becomes the spine tip the
        // planner anchors at; side thoughts stay anchored to the user message.
        let spineTip = userEntry.id;
        if (isFirstMessage) {
          const injected = await this.injectContextFiles(conversationId, body.agentId, userEntry.id);
          if (injected) spineTip = injected.id;
        }
        // Forced retrieval: also awaited and spine-chained — the planner must
        // anchor after the retrieval entry so the hits are in its input DAG.
        if (userPayload.overrides?.rag) {
          const retrieval = await this.runForcedRetrieval(
            conversationId,
            spineTip,
            body.message,
            userPayload.overrides.rag,
          );
          if (retrieval) spineTip = retrieval.id;
        }
        const categorize = isFirstMessage && (await this.categorizer.shouldCategorize(conversationId));
        this.startThoughts({
          conversationId,
          userMessageId: userEntry.id,
          plannerAnchorId: spineTip,
          attachments: attachments ?? [],
          isFirstMessage,
          categorize,
          scope,
          llm,
          titleLlm,
        });
      } finally {
        scope.rootDone();
      }
    });
  }

  private async withMessagePostLock<T>(
    conversationId: string,
    steer: boolean,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (steer) {
      await this.abortActiveAndWait(conversationId);
    } else {
      const prev = this.messagePostLocks.get(conversationId);
      if (prev) await prev.catch(() => undefined);
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.messagePostLocks.set(conversationId, gate);
    try {
      return await fn();
    } finally {
      release();
      if (this.messagePostLocks.get(conversationId) === gate) {
        this.messagePostLocks.delete(conversationId);
      }
    }
  }

  private async abortActiveAndWait(conversationId: string): Promise<void> {
    const scope = this.activeExecutions.get(conversationId);
    if (!scope) return;
    scope.abort();
    await scope.whenFinished();
  }

  /**
   * Scan the workspace for the agent's configured context files (once per
   * conversation — gated by the caller on `isFirstMessage`) and, if any were
   * discovered, append a `context-injection` entry to the chain before the
   * planner thought starts. Best-effort: a scan failure is logged and
   * swallowed rather than failing the user's message.
   */
  private async injectContextFiles(
    conversationId: string,
    agentId: string,
    parentId: string,
  ): Promise<{ id: string } | null> {
    try {
      const agent = await this.agents.get(agentId);
      const result = await this.contextInjection.scan(agent?.default_llm_configuration?.preinject ?? undefined);
      if (!result) return null;
      const created = await this.chatEntries.appendContextInjection(conversationId, {
        parentId,
        files: result.files,
        content: result.content,
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, created.id);
      return created;
    } catch (err) {
      this.logger.warn(
        `context-injection scan failed for conversation ${conversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Forced retrieval (docs/rag-revamp-plan.md): the user opted this message
   * into grounding via `overrides.rag`, so retrieval ALWAYS executes — this
   * is the harness-driven pipeline, distinct from the model-driven `rag`
   * tool. The record is a `retrieval` spine entry appended after the user
   * message (before the planner thought starts), pending → done/failed; the
   * planner anchors after it and reads the hits from the immutable entry
   * DAG, so reprocess replays the same grounding without re-retrieving.
   * A retrieval failure resolves the entry to 'failed' and the turn
   * continues — visibly ungrounded, never silently.
   */
  private async runForcedRetrieval(
    conversationId: string,
    parentId: string,
    messageText: string,
    override: RagOverride,
  ): Promise<{ id: string } | null> {
    // v1 is verbatim-only: the message text is the embedding query. Mode
    // 'preplanned' (a rag-planning thought composes the queries) lands in
    // phase 2b and degrades to verbatim until then.
    const queries: RetrievalQuery[] = [{ text: messageText, origin: 'verbatim' }];
    const storageNames = this.forcedRetrieval.storageNames(override.storages);
    let created: { id: string };
    try {
      created = await this.chatEntries.appendRetrievalEntry(conversationId, {
        parentId,
        source: 'rag',
        queries,
        storages: storageNames,
      });
    } catch (error) {
      this.logger.warn(
        `forced retrieval: could not append entry for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
    await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, created.id);
    try {
      // Same code path as the composer's preview endpoint, so what the user
      // saw before sending is what the turn records.
      const hits = await this.forcedRetrieval.run(queries, override.storages, override.top_k);
      await this.chatEntries.completeRetrievalEntry(conversationId, created.id, { hits });
    } catch (error) {
      this.logger.warn(
        `forced retrieval failed for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.chatEntries.completeRetrievalEntry(conversationId, created.id, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, created.id);
    return created;
  }

  /**
   * Kick off every thought a freshly-posted user message implies:
   *
   * - autoTitle (only on the very first message in the conversation),
   * - one `summarize-attachment` thought per summary-mode attachment,
   * - the planner — but only if there are no summary attachments to
   *   wait on. When summaries ARE pending, the LAST completing
   *   summarize-attachment provider starts the planner itself (see
   *   `SummarizeAttachmentThoughtTypeProvider.maybeStartPlanner`), so
   *   every summary is persisted before the planner input is built
   *   (the input builder folds side `summarize_attachment` streams in).
   *
   * All calls are fire-and-forget; lifecycle is owned by `scope`.
   */
  private startThoughts(args: {
    conversationId: string;
    userMessageId: string;
    /** Spine tip the planner extends: the user message, or the context-injection entry after it. */
    plannerAnchorId: string;
    attachments: ChatAttachment[];
    isFirstMessage: boolean;
    categorize: boolean;
    scope: LifecycleScope;
    llm: LlmRef;
    titleLlm: LlmRef;
  }): void {
    // Title / categorize / attachment summaries are side thoughts anchored to
    // the user message: they run concurrently without touching the spine, so
    // they can never fork the reply timeline.
    if (args.isFirstMessage) {
      void this.thoughtProcessing.startThought({
        provider: this.autoTitleProvider,
        conversationId: args.conversationId,
        scope: args.scope,
        anchorParentId: args.userMessageId,
        lane: 'side',
        llm: args.titleLlm,
      });
      if (args.categorize) {
        void this.thoughtProcessing.startThought({
          provider: this.categorizeProvider,
          conversationId: args.conversationId,
          scope: args.scope,
          anchorParentId: args.userMessageId,
          lane: 'side',
          llm: args.titleLlm,
        });
      }
    }
    const summaryAttachments = args.attachments.filter((a) => a.mode === 'summary');
    if (summaryAttachments.length === 0) {
      void this.thoughtProcessing.startThought({
        provider: this.plannerProvider,
        conversationId: args.conversationId,
        scope: args.scope,
        anchorParentId: args.plannerAnchorId,
        lane: 'spine',
        llm: args.llm,
      });
      return;
    }
    const peersDone = createBatchBarrier(summaryAttachments.length);
    for (const attachment of summaryAttachments) {
      void this.thoughtProcessing.startThought({
        provider: this.summarizeAttachmentProvider,
        conversationId: args.conversationId,
        scope: args.scope,
        anchorParentId: args.userMessageId,
        lane: 'side',
        llm: args.llm,
        input: {
          conversationId: args.conversationId,
          attachment,
          userMessageId: args.userMessageId,
          plannerAnchorId: args.plannerAnchorId,
          peersDone,
          plannerLlm: args.llm,
        },
      });
    }
  }
}
