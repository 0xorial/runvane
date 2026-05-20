import { Injectable, Logger } from '@nestjs/common';
import { SseType } from '../contracts/sse.js';
import { AgentsRepo } from '../db/repositories/agents.repo.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated } from '../sse/sse-helpers.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import { AutoTitleThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/autoTitleProvider.js';
import { PlannerThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/plannerProvider.js';
import { SummarizeThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/summarizeProvider.js';
import type { LlmRef } from '../thoughtProcessing/types.js';
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
    private readonly uploads: UploadsService,
    private readonly agents: AgentsRepo,
  ) {}

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
    const attachments = body.attachmentIds && body.attachmentIds.length > 0
      ? await this.uploads.resolveChatAttachments(body.attachmentIds)
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

    if (existingMessages.length === 0) {
      this.thoughtProcessing.startThought({ provider: this.autoTitleProvider, conversationId, scope, chain, llm: titleLlm });
    }
    this.thoughtProcessing.startThought({ provider: this.plannerProvider, conversationId, scope, chain, llm });
    scope.rootDone();
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
