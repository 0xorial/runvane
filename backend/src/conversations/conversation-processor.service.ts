import { Injectable, Logger } from '@nestjs/common';
import { SseType } from '../contracts/sse.js';
import { ContextInjectionService } from '../context-injection/context-injection.service.js';
import { AgentsRepo } from '../db/repositories/agents.repo.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
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
import type { LlmRef } from '../thoughtProcessing/types.js';
import { RunToolService } from '../tools/run-tool.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { ConversationCategorizerService } from './conversation-categorizer.service.js';
import { ChatChain } from './chat-chain.js';
import { PostConversationMessageDto } from './dto/post-conversation-message.dto.js';
import { LifecycleScope } from './lifecycle-scope.js';
import { resolveSummarizeRange } from './summarizeRange.js';

type ConversationRun = { scope: LifecycleScope; chain: ChatChain };

/** True for AbortController/AbortSignal cancellations (expected, not failures). */
function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError'
  );
}

@Injectable()
export class ConversationProcessorService {
  private readonly logger = new Logger(ConversationProcessorService.name);
  private readonly activeExecutions = new Map<string, LifecycleScope>();
  private readonly messagePostLocks = new Map<string, Promise<unknown>>();
  /** Messages posted with `enqueue` while a run was in flight, FIFO per conversation. */
  private readonly pendingMessages = new Map<string, PostConversationMessageDto[]>();

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
    private readonly categorizer: ConversationCategorizerService,
    private readonly contextInjection: ContextInjectionService,
  ) {}

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
    const { scope, chain } = await this.beginRun(args.conversationId, { joinActive: true });
    try {
      await this.runTool.approveAndRun(
        {
          conversationId: args.conversationId,
          toolEntryId: args.toolEntryId,
          agentId,
          ...(args.editedParameters !== undefined ? { editedParameters: args.editedParameters } : {}),
        },
        scope,
        chain,
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
    const { scope, chain } = await this.beginRun(args.conversationId, { joinActive: true });
    try {
      await this.runTool.retryToolInvocation(
        { conversationId: args.conversationId, toolEntryId: args.toolEntryId, agentId },
        scope,
        chain,
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
    const { scope, chain } = await this.beginRun(args.conversationId, { joinActive: true });
    try {
      await this.runTool.denyToolInvocation(
        { conversationId: args.conversationId, toolEntryId: args.toolEntryId, agentId },
        scope,
        chain,
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
   * Start a run scope + chain for a conversation.
   *
   * By default a new run steers: it aborts and replaces any active run. Pass
   * `joinActive` for approve/deny of a fanned-out tool — those must NOT disturb
   * sibling tools still executing in the original run, so when a run is already
   * active we leave it registered and run alongside it. The shared (durable)
   * fan-in coordinator still ties the two together and continues the planner
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
    const reparent = async (entryId: string, newParentId: string) => {
      await this.chatEntries.updateChatEntryParent(conversationId, entryId, newParentId);
      await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, entryId);
    };
    return { scope, chain: new ChatChain(reparent) };
  }

  cancelProcessing(conversationId: string): number {
    const scope = this.activeExecutions.get(conversationId);
    if (!scope) return 0;
    scope.abort();
    return 1;
  }

  /** Snapshot of queued (not-yet-posted) messages for a conversation. */
  listPendingMessages(conversationId: string): Array<{ clientRequestId: string; text: string }> {
    const queue = this.pendingMessages.get(conversationId) ?? [];
    return queue
      .filter((m): m is PostConversationMessageDto & { clientRequestId: string } => Boolean(m.clientRequestId))
      .map((m) => ({ clientRequestId: m.clientRequestId, text: m.message }));
  }

  /** Remove a queued message before it drains. Returns true if one was removed. */
  cancelPendingMessage(conversationId: string, clientRequestId: string): boolean {
    const queue = this.pendingMessages.get(conversationId);
    if (!queue) return false;
    const idx = queue.findIndex((m) => m.clientRequestId === clientRequestId);
    if (idx === -1) return false;
    queue.splice(idx, 1);
    if (queue.length === 0) this.pendingMessages.delete(conversationId);
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
    const queue = this.pendingMessages.get(conversationId);
    if (!queue || queue.length === 0) return;
    const next = queue.shift()!;
    if (queue.length === 0) this.pendingMessages.delete(conversationId);

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
    const { scope, chain } = await this.beginRun(args.conversationId);
    try {
      const result = await this.thoughtProcessing.startReprocessContext(args, scope, chain);
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
    const { scope, chain } = await this.beginRun(args.conversationId);
    try {
      const llm = await this.thoughtProcessing.getLlmRef();
      const result = await this.thoughtProcessing.startReprocessReason(args, scope, chain, llm);
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

    const { scope, chain } = await this.beginRun(args.conversationId);
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
      chain.setTip(sibling.id);
      const siblingPayload = await this.chatEntries.getChatEntry(args.conversationId, sibling.id);
      if (!siblingPayload || siblingPayload.type !== 'user-message') {
        throw new Error(`appended user-message ${sibling.id} not retrievable as user-message`);
      }
      await publishConversationUpdated(this.hub, this.conversations, this.chatEntries, args.conversationId);
      this.hub.publish(args.conversationId, { type: SseType.USER_MESSAGE, entry: siblingPayload });

      this.thoughtProcessing.startThought({
        provider: this.plannerProvider,
        conversationId: args.conversationId,
        scope,
        chain,
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

    const { scope, chain } = await this.beginRun(args.conversationId);
    try {
      const llm = await this.resolveLlmRef({ agentId: summarizeAgentId });
      // Anchor the new branch at the parent of `firstEntryToSummarize` so the
      // prepare / stream / checkpoint-summary entries become a sibling of the
      // original tail. The original tail stays reachable via the branch
      // selector on the resulting summary entry.
      chain.setTip(range.fromParentId);

      this.thoughtProcessing.startThought({
        provider: this.summarizeProvider,
        conversationId: args.conversationId,
        scope,
        chain,
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
   * Re-run categorization as a standalone thought after a pinned chat is
   * unlocked. Fire-and-forget. There's no active run to ride here, so it opens
   * its own run, appends the categorize thought at the current leaf, and
   * advances the default-view leaf so the thought renders and a later message
   * chains after it rather than branching off the old leaf.
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
    const conversation = await this.conversations.get(conversationId);
    const leaf = conversation?.defaultViewLeafEntryId ?? null;

    const { scope, chain } = await this.beginRun(conversationId);
    try {
      if (leaf) chain.setTip(leaf);
      this.thoughtProcessing.startThought({
        provider: this.categorizeProvider,
        conversationId,
        scope,
        chain,
        llm: titleLlm,
      });
    } finally {
      scope.rootDone();
    }
    await scope.whenFinished();

    const tip = chain.getTip();
    if (tip && tip !== leaf) {
      await this.chatEntries.setDefaultViewLeaf(conversationId, tip);
      await publishConversationUpdated(this.hub, this.conversations, this.chatEntries, conversationId);
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
      const queue = this.pendingMessages.get(conversationId) ?? [];
      queue.push(body);
      this.pendingMessages.set(conversationId, queue);
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
      const { scope, chain } = await this.beginRun(conversationId);
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
        chain.setTip(userEntry.id);
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
        if (isFirstMessage) {
          await this.injectContextFiles(conversationId, body.agentId, chain);
        }
        const categorize = isFirstMessage && (await this.categorizer.shouldCategorize(conversationId));
        this.startThoughts({
          conversationId,
          userMessageId: userEntry.id,
          attachments: attachments ?? [],
          isFirstMessage,
          categorize,
          scope,
          chain,
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
  private async injectContextFiles(conversationId: string, agentId: string, chain: ChatChain): Promise<void> {
    try {
      const agent = await this.agents.get(agentId);
      const result = await this.contextInjection.scan(agent?.default_llm_configuration?.preinject ?? undefined);
      if (!result) return;
      const created = await chain.append(null, (parentId) =>
        this.chatEntries.appendContextInjection(conversationId, {
          parentId,
          files: result.files,
          content: result.content,
        }),
      );
      await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, created.id);
    } catch (err) {
      this.logger.warn(
        `context-injection scan failed for conversation ${conversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
   *   the planner prompt is guaranteed to see every
   *   `summarize_attachment` thought stream with its persisted
   *   `summaryText`.
   *
   * All calls are fire-and-forget; lifecycle is owned by `scope`.
   */
  private startThoughts(args: {
    conversationId: string;
    userMessageId: string;
    attachments: ChatAttachment[];
    isFirstMessage: boolean;
    categorize: boolean;
    scope: LifecycleScope;
    chain: ChatChain;
    llm: LlmRef;
    titleLlm: LlmRef;
  }): void {
    if (args.isFirstMessage) {
      this.thoughtProcessing.startThought({
        provider: this.autoTitleProvider,
        conversationId: args.conversationId,
        scope: args.scope,
        chain: args.chain,
        llm: args.titleLlm,
      });
      // Auto-categorize as a first-class thought on the run's chain (right after
      // the title) so it stays linear with the rest of the run instead of
      // branching off the user message. Gated upstream by `shouldCategorize`.
      if (args.categorize) {
        this.thoughtProcessing.startThought({
          provider: this.categorizeProvider,
          conversationId: args.conversationId,
          scope: args.scope,
          chain: args.chain,
          llm: args.titleLlm,
        });
      }
    }
    const summaryAttachments = args.attachments.filter((a) => a.mode === 'summary');
    if (summaryAttachments.length === 0) {
      this.thoughtProcessing.startThought({
        provider: this.plannerProvider,
        conversationId: args.conversationId,
        scope: args.scope,
        chain: args.chain,
        llm: args.llm,
      });
      return;
    }
    const peersDone = createBatchBarrier(summaryAttachments.length);
    for (const attachment of summaryAttachments) {
      this.thoughtProcessing.startThought({
        provider: this.summarizeAttachmentProvider,
        conversationId: args.conversationId,
        scope: args.scope,
        chain: args.chain,
        llm: args.llm,
        input: {
          conversationId: args.conversationId,
          attachment,
          userMessageId: args.userMessageId,
          peersDone,
          plannerLlm: args.llm,
        },
      });
    }
  }
}
