import { Injectable, Logger } from '@nestjs/common';
import type { AgenticPlannerOutput, LlmDecision } from '../../contracts/chatEntry.js';
import { SseType } from '../../contracts/sse.js';
import { AgentsRepo } from '../../db/repositories/agents.repo.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../db/repositories/conversations.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { incrementalDelta, publishChatEntryUpsert, publishConversationUpdated } from '../../sse/sse-helpers.js';
import { extractAssistantOutputFromJsonLike, parsePlannerOutput, type ParsedPlannerOutput } from '../lib/plannerTextParsing.js';
import type { ThoughtExecution, ThoughtReasonLlmResult, ThoughtTypeProvider } from '../types.js';

type PlannerParseResult = { status: 'ok'; parsed: AgenticPlannerOutput };

export type PlannerThought = ThoughtExecution & {
  thoughtType: 'planner';
};

export type PlannerPrepareSeed = {
  conversationId: string;
  anchorEntryId: string;
  agentId: string;
  userText: string;
  systemPrompt: string;
  enabledToolIds: string[];
};

export type PlannerPrepareOutput = {
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
  agentId: string;
  userText: string;
  llmRequest: string;
  enabledToolIds: string[];
};

export type PlannerReasonOutput = {
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
  agentId: string;
  userText: string;
  prompt: string;
  enabledToolIds: string[];
  requestStartedMs: number;
  result?: ThoughtReasonLlmResult;
};

type StreamState = {
  reconstructedReply: string;
  streamedAnswer: string;
  assistantEntryId: string | null;
  pending: Promise<void>;
};

type PlannerProviderContract = ThoughtTypeProvider<PlannerPrepareSeed, PlannerPrepareOutput, PlannerReasonOutput, PlannerThought>;

@Injectable()
export class PlannerThoughtTypeProvider implements PlannerProviderContract {
  private readonly logger = new Logger(PlannerThoughtTypeProvider.name);
  private readonly liveStreamState = new Map<string, StreamState>();

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly conversations: ConversationsRepo,
    private readonly agents: AgentsRepo,
    private readonly hub: SseHubService,
  ) {}

  createPrepareInput: NonNullable<PlannerProviderContract['createPrepareInput']> = async ({ conversationId }) => {
    const entries = await this.chatEntries.listMessages(conversationId);
    const anchorUserMessage = [...entries].reverse().find((entry) => entry.type === 'user-message');
    if (!anchorUserMessage) {
      throw new Error(`planner requires a user-message in conversation ${conversationId}`);
    }
    const leafEntryId = await this.chatEntries.getActiveLeafEntryId(conversationId);
    if (!leafEntryId) {
      throw new Error(`planner requires an active leaf entry in conversation ${conversationId}`);
    }
    const agentId = anchorUserMessage.agentId;
    const agent = await this.agents.get(agentId);
    if (!agent) throw new Error(`planner agent not found: ${agentId}`);
    return {
      thought: {
        thoughtType: 'planner',
        thoughtId: crypto.randomUUID(),
        conversationId,
        prepareEntryId: '',
        streamEntryId: '',
      },
      seed: {
        conversationId,
        anchorEntryId: leafEntryId,
        agentId,
        userText: anchorUserMessage.text,
        systemPrompt: agent.system_prompt ?? '',
        enabledToolIds: [],
      },
    };
  };

  runPrepare: PlannerProviderContract['runPrepare'] = async (_step, input) => ({
    thought: input.thought,
    prepareOutput: {
      conversationId: input.seed.conversationId,
      streamEntryId: input.thought.streamEntryId,
      thoughtActionEntryId: input.thought.thoughtActionEntryId ?? null,
      agentId: input.seed.agentId,
      userText: input.seed.userText,
      llmRequest: buildPlannerPrompt(input.seed.systemPrompt, input.seed.userText, input.seed.enabledToolIds),
      enabledToolIds: input.seed.enabledToolIds,
    },
  });

  runReason: PlannerProviderContract['runReason'] = async (_step, input) => ({
    thought: input.thought,
    reasonOutput: {
      conversationId: input.prepareOutput.conversationId,
      streamEntryId: input.prepareOutput.streamEntryId,
      thoughtActionEntryId: input.prepareOutput.thoughtActionEntryId,
      agentId: input.prepareOutput.agentId,
      userText: input.prepareOutput.userText,
      prompt: input.prepareOutput.llmRequest,
      enabledToolIds: input.prepareOutput.enabledToolIds,
      requestStartedMs: Date.now(),
    },
  });

  runDecision: PlannerProviderContract['runDecision'] = async (_step, input) => {
    const reason = input.reasonOutput;
    if (!reason.result) throw new Error('planner decision requires runtime-provided LLM result');
    const state = this.liveStreamState.get(reason.streamEntryId);
    if (state) await state.pending.catch(() => undefined);
    this.liveStreamState.delete(reason.streamEntryId);

    const parsed = parsePlannerOutput(reason.result.fullResponse);
    const requestedToolCalls = parsed.toolRequests.filter((t) => reason.enabledToolIds.includes(t.toolName));
    const assistantText = parsed.assistantOutput.trim();
    const action = requestedToolCalls.length > 0 ? 'tool_call' : 'final_answer';
    const parseResult = toPlannerParseResult(parsed);
    const decision = toLlmDecision(parsed, requestedToolCalls);

    await this.persistStreamEntryDecision(reason, parseResult, decision);
    const finalAssistantEntryId = await this.finalizeAssistantMessage(state ?? null, reason, assistantText);
    await this.finalizeThoughtAction(reason, action, assistantText, parseResult);
    this.publishPlannerResponse(reason, requestedToolCalls.length, assistantText);
    await publishConversationUpdated(this.hub, this.conversations, reason.conversationId);

    if (requestedToolCalls.length > 0) {
      for (const requested of requestedToolCalls) {
        await this.executeToolRequest({
          conversationId: reason.conversationId,
          continuationAnchorId: finalAssistantEntryId ?? reason.thoughtActionEntryId ?? reason.streamEntryId,
          agentId: reason.agentId,
          userText: reason.userText,
          enabledToolIds: reason.enabledToolIds,
          followup: parsed.followup,
          toolName: requested.toolName,
          toolRequest: requested.toolRequest,
        });
      }
    }
  };

  getReasonLlmRequest: NonNullable<PlannerProviderContract['getReasonLlmRequest']> = (input) => ({
    prompt: input.reasonOutput.prompt,
  });

  onReasonLlmDelta: NonNullable<PlannerProviderContract['onReasonLlmDelta']> = (input, delta) => {
    if (!delta) return;
    const reason = input.reasonOutput;
    const state = this.ensureState(reason.streamEntryId);
    state.reconstructedReply += delta;

    this.hub.publish(reason.conversationId, {
      type: SseType.PLANNER_LLM_STREAM,
      chatEntryId: reason.streamEntryId,
      delta,
    });

    const extracted = extractAssistantOutputFromJsonLike(state.reconstructedReply);
    const answerDelta = incrementalDelta(state.streamedAnswer, extracted);
    if (!answerDelta) return;
    state.streamedAnswer = extracted;
    state.pending = state.pending
      .then(() => this.streamAssistantDelta(state, reason, answerDelta))
      .catch((error) => {
        this.logger.error(`assistant_stream pipe failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  applyReasonLlmResult: NonNullable<PlannerProviderContract['applyReasonLlmResult']> = (input, result) => ({
    ...input,
    reasonOutput: { ...input.reasonOutput, result },
  });

  getLifecycleStartRequest: NonNullable<PlannerProviderContract['getLifecycleStartRequest']> = (input) => ({
    conversationId: input.seed.conversationId,
    parentId: input.seed.anchorEntryId,
    llmRequest: input.seed.userText,
    kind: 'planner',
    includeAction: true,
    summary: 'Decision planning',
  });

  applyLifecycleStart: NonNullable<PlannerProviderContract['applyLifecycleStart']> = (input, started) => {
    const thought: PlannerThought = {
      ...input.thought,
      thoughtId: started.thoughtId,
      conversationId: input.seed.conversationId,
      prepareEntryId: started.prepareEntryId,
      streamEntryId: started.streamEntryId,
    };
    if (started.thoughtActionEntryId) thought.thoughtActionEntryId = started.thoughtActionEntryId;
    return { ...input, thought };
  };

  getPreparedReasonInfo: NonNullable<PlannerProviderContract['getPreparedReasonInfo']> = (input) => ({
    requestText: input.prepareOutput.userText,
  });

  private ensureState(streamEntryId: string): StreamState {
    const existing = this.liveStreamState.get(streamEntryId);
    if (existing) return existing;
    const created: StreamState = {
      reconstructedReply: '',
      streamedAnswer: '',
      assistantEntryId: null,
      pending: Promise.resolve(),
    };
    this.liveStreamState.set(streamEntryId, created);
    return created;
  }

  private async streamAssistantDelta(state: StreamState, reason: PlannerReasonOutput, delta: string): Promise<void> {
    if (!state.assistantEntryId) {
      const created = await this.chatEntries.appendAssistantMessage(reason.conversationId, {
        text: '',
        parentId: reason.thoughtActionEntryId ?? null,
      });
      state.assistantEntryId = created.id;
      const upsert = await this.chatEntries.getChatEntry(reason.conversationId, created.id);
      if (upsert) {
        this.hub.publish(reason.conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry: upsert });
      }
    }
    const payload: { type: typeof SseType.ASSISTANT_STREAM; chatEntryId: string; delta: string; parentId?: string } = {
      type: SseType.ASSISTANT_STREAM,
      chatEntryId: state.assistantEntryId,
      delta,
    };
    if (reason.thoughtActionEntryId) payload.parentId = reason.thoughtActionEntryId;
    this.hub.publish(reason.conversationId, payload);
  }

  private async finalizeAssistantMessage(
    state: StreamState | null,
    reason: PlannerReasonOutput,
    assistantText: string,
  ): Promise<string | null> {
    if (!assistantText) return state?.assistantEntryId ?? null;
    if (state?.assistantEntryId) {
      await this.chatEntries.updateAssistantMessage(reason.conversationId, {
        id: state.assistantEntryId,
        text: assistantText,
      });
      const entry = await this.chatEntries.getChatEntry(reason.conversationId, state.assistantEntryId);
      if (entry) this.hub.publish(reason.conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry });
      return state.assistantEntryId;
    }
    const created = await this.chatEntries.appendAssistantMessage(reason.conversationId, {
      text: assistantText,
      parentId: reason.thoughtActionEntryId ?? null,
    });
    const entry = await this.chatEntries.getChatEntry(reason.conversationId, created.id);
    if (entry) this.hub.publish(reason.conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry });
    return created.id;
  }

  private async persistStreamEntryDecision(
    reason: PlannerReasonOutput,
    parseResult: PlannerParseResult,
    decision: LlmDecision | null,
  ): Promise<void> {
    const usage = reason.result?.usage;
    const patch: Record<string, unknown> = { parseResult, decision };
    if (usage) {
      patch.promptTokens = usage.promptTokens;
      patch.completionTokens = usage.completionTokens;
      if (typeof usage.cachedPromptTokens === 'number') patch.cachedPromptTokens = usage.cachedPromptTokens;
    }
    await this.chatEntries.mergeEntryPayload(reason.conversationId, reason.streamEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, reason.conversationId, reason.streamEntryId);
  }

  private async finalizeThoughtAction(
    reason: PlannerReasonOutput,
    action: 'tool_call' | 'final_answer',
    assistantText: string,
    parseResult: PlannerParseResult,
  ): Promise<void> {
    if (!reason.thoughtActionEntryId) return;
    const summary = action === 'tool_call' ? 'Queued tool call(s)' : assistantText || 'Completed';
    await this.chatEntries.updateThoughtAction(reason.conversationId, reason.thoughtActionEntryId, {
      status: 'completed',
      summary,
      action,
    });
    await this.chatEntries.mergeEntryPayload(reason.conversationId, reason.thoughtActionEntryId, { parseResult });
    await publishChatEntryUpsert(this.hub, this.chatEntries, reason.conversationId, reason.thoughtActionEntryId);
  }

  private publishPlannerResponse(reason: PlannerReasonOutput, toolCallCount: number, assistantText: string): void {
    const payload: {
      type: typeof SseType.PLANNER_RESPONSE;
      chatEntryId: string;
      summary: string;
      finished: boolean;
      action?: string;
      llmProviderId?: string;
      llmModel?: string;
      promptTokens?: number;
      cachedPromptTokens?: number;
      completionTokens?: number;
    } = {
      type: SseType.PLANNER_RESPONSE,
      chatEntryId: reason.streamEntryId,
      summary: toolCallCount > 0 ? `Queued ${toolCallCount} tool call(s)` : assistantText || 'Completed',
      finished: true,
      action: toolCallCount > 0 ? 'tool_call' : 'final_answer',
    };
    const result = reason.result;
    if (result?.providerId) payload.llmProviderId = result.providerId;
    if (result?.model) payload.llmModel = result.model;
    if (result?.usage) {
      payload.promptTokens = result.usage.promptTokens;
      payload.completionTokens = result.usage.completionTokens;
      if (typeof result.usage.cachedPromptTokens === 'number') {
        payload.cachedPromptTokens = result.usage.cachedPromptTokens;
      }
    }
    this.hub.publish(reason.conversationId, payload);
  }

  private async executeToolRequest(_input: {
    conversationId: string;
    continuationAnchorId: string;
    agentId: string;
    userText: string;
    enabledToolIds: string[];
    followup: 'continue' | 'finalize';
    toolName: string;
    toolRequest: string;
  }): Promise<void> {
    throw new Error('planner tool execution is not wired yet');
  }
}

function buildPlannerPrompt(systemPrompt: string, userText: string, toolIds: string[]): string {
  return [
    'You are a planner. Return JSON with assistant_output and optional tool_requests.',
    `System prompt: ${systemPrompt || '(empty)'}`,
    `Allowed tools: ${toolIds.join(', ') || '(none)'}`,
    `User message: ${userText}`,
  ].join('\n');
}

function toPlannerParseResult(parsed: ParsedPlannerOutput): PlannerParseResult {
  const out: AgenticPlannerOutput = {
    tool_calls: [],
    tool_requests: parsed.toolRequests.map((t) => ({ tool_name: t.toolName, request: t.toolRequest })),
    followup: parsed.followup,
  };
  if (parsed.assistantOutput) out.assistant_output = parsed.assistantOutput;
  return { status: 'ok', parsed: out };
}

function toLlmDecision(
  parsed: ParsedPlannerOutput,
  requestedToolCalls: Array<{ toolName: string; toolRequest: string }>,
): LlmDecision | null {
  if (requestedToolCalls.length > 0) {
    const first = requestedToolCalls[0];
    return { type: 'tool-invocation', toolId: first.toolName, parameters: { request: first.toolRequest } };
  }
  if (parsed.assistantOutput) return { type: 'user-response', text: parsed.assistantOutput };
  return null;
}
