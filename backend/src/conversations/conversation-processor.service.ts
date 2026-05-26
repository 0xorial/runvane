import { Injectable, Logger } from '@nestjs/common';
import { SseType } from '../contracts/sse.js';
import { AgentsRepo } from '../db/repositories/agents.repo.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated } from '../sse/sse-helpers.js';
import { createBatchBarrier } from '../thoughtProcessing/lib/batchBarrier.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import { AutoTitleThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/autoTitleProvider.js';
import { PlannerThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/plannerProvider.js';
import { SummarizeAttachmentThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/summarizeAttachmentProvider.js';
import { SummarizeThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/summarizeProvider.js';
import type { ChatAttachment } from '../contracts/chatEntry.js';
import type { LlmRef } from '../thoughtProcessing/types.js';
import { RunToolService } from '../tools/run-tool.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { ChatChain } from './chat-chain.js';
import { PostConversationMessageDto } from './dto/post-conversation-message.dto.js';
import { LifecycleScope } from './lifecycle-scope.js';

type ConversationRun = { scope: LifecycleScope; chain: ChatChain };

@Injectable()
export class ConversationProcessorService {
  private readonly logger = new Logger(ConversationProcessorService.name);
  private readonly activeExecutions = new Map<string, LifecycleScope>();

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly thoughtProcessing: ThoughtProcessingService,
    private readonly conversations: ConversationsRepo,
    private readonly hub: SseHubService,
    private readonly autoTitleProvider: AutoTitleThoughtTypeProvider,
    private readonly plannerProvider: PlannerThoughtTypeProvider,
    private readonly summarizeProvider: SummarizeThoughtTypeProvider,
    private readonly summarizeAttachmentProvider: SummarizeAttachmentThoughtTypeProvider,
    private readonly uploads: UploadsService,
    private readonly agents: AgentsRepo,
    private readonly runTool: RunToolService,
  ) {}

  async approveToolInvocation(args: { conversationId: string; toolEntryId: string }): Promise<void> {
    const entries = await this.chatEntries.listChatEntriesFromLeaf(args.conversationId, args.toolEntryId);
    const anchorUser = [...entries].reverse().find((e) => e.type === 'user-message');
    if (!anchorUser) throw new Error('conversation has no user message to resolve the agent from');
    const agentId = anchorUser.agentId;
    const llm = await this.resolveLlmRef({ agentId });
    const { scope, chain } = this.beginRun(args.conversationId);
    await this.runTool.approveAndRun(
      { conversationId: args.conversationId, toolEntryId: args.toolEntryId, agentId },
      scope,
      chain,
      llm,
    );
    scope.rootDone();
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

  private beginRun(conversationId: string): ConversationRun {
    this.activeExecutions.get(conversationId)?.abort();
    const scope = new LifecycleScope(
      () => {
        if (this.activeExecutions.get(conversationId) === scope) {
          this.activeExecutions.delete(conversationId);
        }
      },
      (error) => {
        this.logger.error(
          `lifecycle scope task failed: conversation=${conversationId}`,
          error instanceof Error ? error.stack : String(error),
        );
      },
    );
    this.activeExecutions.set(conversationId, scope);
    const reparent = (entryId: string, newParentId: string) =>
      this.chatEntries.updateChatEntryParent(conversationId, entryId, newParentId);
    return { scope, chain: new ChatChain(reparent) };
  }

  cancelProcessing(conversationId: string): number {
    const scope = this.activeExecutions.get(conversationId);
    if (!scope) return 0;
    scope.abort();
    return 1;
  }

  async startReprocessContext(args: {
    conversationId: string;
    sourceEntryId: string;
    editedRequestText: string;
    llm?: LlmRef;
  }): Promise<{ plannerEntryId: string }> {
    const { scope, chain } = this.beginRun(args.conversationId);
    const result = await this.thoughtProcessing.startReprocessContext(args, scope, chain);
    await publishConversationUpdated(this.hub, this.conversations, args.conversationId);
    scope.rootDone();
    return result;
  }

  async startReprocessReason(args: {
    conversationId: string;
    sourceEntryId: string;
    editedResponse: string;
  }): Promise<{ plannerEntryId: string }> {
    const { scope, chain } = this.beginRun(args.conversationId);
    const llm = await this.thoughtProcessing.getLlmRef();
    const result = await this.thoughtProcessing.startReprocessReason(args, scope, chain, llm);
    await publishConversationUpdated(this.hub, this.conversations, args.conversationId);
    scope.rootDone();
    return result;
  }

  async reprocessUserMessage(args: {
    conversationId: string;
    sourceEntryId: string;
    editedText: string;
  }): Promise<{ userMessageEntryId: string }> {
    const source = await this.chatEntries.getChatEntry(args.conversationId, args.sourceEntryId);
    if (!source) throw new Error(`source entry not found: ${args.sourceEntryId}`);
    if (source.type !== 'user-message') {
      throw new Error(`reprocess target ${args.sourceEntryId} is not a user-message: ${source.type}`);
    }

    const { scope, chain } = this.beginRun(args.conversationId);
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
    });
    await this.chatEntries.setDefaultViewLeaf(args.conversationId, sibling.id);
    chain.setTip(sibling.id);
    const siblingPayload = await this.chatEntries.getChatEntry(args.conversationId, sibling.id);
    if (!siblingPayload || siblingPayload.type !== 'user-message') {
      throw new Error(`appended user-message ${sibling.id} not retrievable as user-message`);
    }
    this.hub.publish(args.conversationId, { type: SseType.USER_MESSAGE, entry: siblingPayload });
    await publishConversationUpdated(this.hub, this.conversations, args.conversationId);

    this.thoughtProcessing.startThought({
      provider: this.plannerProvider,
      conversationId: args.conversationId,
      scope,
      chain,
      llm,
    });
    scope.rootDone();
    return { userMessageEntryId: sibling.id };
  }

  async startSummarize(args: { conversationId: string; firstEntryToSummarize: string }): Promise<void> {
    const activeChain = await this.chatEntries.listChatEntries(args.conversationId);
    if (activeChain.length === 0) throw new Error('conversation has no entries to summarize');

    const range = resolveSummarizeRange(activeChain, args.firstEntryToSummarize);

    const { scope, chain } = this.beginRun(args.conversationId);
    const llm = await this.thoughtProcessing.getLlmRef();
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
    scope.rootDone();
  }

  async processMessage(conversationId: string, body: PostConversationMessageDto): Promise<void> {
    const { scope, chain } = this.beginRun(conversationId);
    const llm = await this.resolveLlmRef({
      explicitProviderId: body.llm?.providerId,
      explicitModel: body.llm?.model,
      agentId: body.agentId,
    });
    const titleLlm = await this.thoughtProcessing.getTitleLlmRef(llm);
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
    });
    await this.chatEntries.setDefaultViewLeaf(conversationId, userEntry.id);
    chain.setTip(userEntry.id);
    const userPayload = await this.chatEntries.getChatEntry(conversationId, userEntry.id);
    if (!userPayload || userPayload.type !== 'user-message') {
      throw new Error(`appended user-message ${userEntry.id} not retrievable as user-message`);
    }
    this.hub.publish(conversationId, {
      type: SseType.USER_MESSAGE,
      entry: userPayload,
      ...(body.clientRequestId ? { clientRequestId: body.clientRequestId } : {}),
    });
    await publishConversationUpdated(this.hub, this.conversations, conversationId);

    this.startThoughts({
      conversationId,
      userMessageId: userEntry.id,
      attachments: attachments ?? [],
      isFirstMessage: existingMessages.length === 0,
      scope,
      chain,
      llm,
      titleLlm,
    });
    scope.rootDone();
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
   *   `summarize_attachment_llm_stream` entry with its persisted
   *   `summaryText`.
   *
   * All calls are fire-and-forget; lifecycle is owned by `scope`.
   */
  private startThoughts(args: {
    conversationId: string;
    userMessageId: string;
    attachments: ChatAttachment[];
    isFirstMessage: boolean;
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

/**
 * Resolve the entries to fold + their anchor parent.
 *
 * `firstEntryToSummarize` is the inclusive start of the range; the range
 * extends through the active-chain leaf. The summary anchors as a child
 * of the entry preceding `firstEntryToSummarize`.
 *
 * The "active chain" passed in is whatever the user is currently viewing
 * (default-view-leaf lineage). Scaffolding entries (thought prepares,
 * stream entries, action entries) are filtered out of `rangeEntries` —
 * they're internal plumbing and don't belong in the summary input — but
 * the range bounds stay anchored to the original entry ids regardless of
 * type, so the link back to the unfolded sibling branch is preserved.
 */
function resolveSummarizeRange(
  activeChain: import('../contracts/chatEntry.js').ChatEntry[],
  firstEntryToSummarize: string,
): {
  fromEntryId: string;
  toEntryId: string;
  fromParentId: string;
  rangeEntries: import('../contracts/chatEntry.js').ChatEntry[];
  rangeEntryCount: number;
} {
  if (activeChain.length === 0) throw new Error('active chain is empty');
  const startIdx = activeChain.findIndex((e) => e.id === firstEntryToSummarize);
  if (startIdx < 0) {
    throw new Error(`firstEntryToSummarize ${firstEntryToSummarize} is not on the active chain`);
  }
  if (startIdx === 0) {
    // We need a parent BEFORE the range so the new branch has somewhere to
    // hang. Folding the very first entry would orphan the summary's parent
    // pointer, defeating the purpose of branching. Disallow.
    throw new Error('cannot summarize from the very first entry of the conversation');
  }
  const parent = activeChain[startIdx - 1]!;
  const slice = activeChain.slice(startIdx);
  const visibleSlice = slice.filter(
    (e) =>
      e.type === 'user-message' ||
      e.type === 'assistant-message' ||
      e.type === 'tool-invocation' ||
      e.type === 'checkpoint-summary',
  );
  if (visibleSlice.length === 0) {
    throw new Error('summarize range contains no user-visible turns');
  }
  return {
    fromEntryId: slice[0]!.id,
    toEntryId: activeChain[activeChain.length - 1]!.id,
    fromParentId: parent.id,
    rangeEntries: visibleSlice,
    rangeEntryCount: visibleSlice.length,
  };
}
