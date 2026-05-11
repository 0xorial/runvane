import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import type { AgentEntity } from '../../agents/agent.entity.js';
import type { AgenticPlannerOutput, ChatEntry, LlmDecision } from '../../contracts/chatEntry.js';
import { SseType } from '../../contracts/sse.js';
import { AgentsRepo } from '../../db/repositories/agents.repo.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../db/repositories/conversations.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { incrementalDelta, publishChatEntryUpsert, publishConversationUpdated } from '../../sse/sse-helpers.js';
import { ToolRegistry } from '../../tools/tool-registry.js';
import { buildPlannerPrompt } from '../lib/plannerPrompt.js';
import { extractAssistantOutputFromJsonLike, parsePlannerOutput, type ParsedPlannerOutput } from '../lib/plannerTextParsing.js';
import { ThoughtProcessingService } from '../thought-processing.service.js';
import type { ThoughtLifecycleEntries, ThoughtReasonLlmResult, ThoughtTypeProvider } from '../types.js';
import { ToolParamsThoughtTypeProvider, type ToolParamsInput } from './toolParamsProvider.js';

export type PlannerInput = {
  conversationId: string;
  anchorEntryId: string;
  agentId: string;
  userText: string;
  systemPrompt: string;
  enabledToolIds: string[];
  entries: ChatEntry[];
  triggerEntry: ChatEntry | null;
};

type StreamState = {
  reconstructedReply: string;
  streamedAnswer: string;
  assistantEntryId: string | null;
  pending: Promise<void>;
};

type PlannerParseResult = { status: 'ok'; parsed: AgenticPlannerOutput };

@Injectable()
export class PlannerThoughtTypeProvider implements ThoughtTypeProvider<PlannerInput, 'planner'> {
  readonly thoughtType = 'planner' as const;
  private readonly logger = new Logger(PlannerThoughtTypeProvider.name);
  private readonly liveStreamState = new Map<string, StreamState>();

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly conversations: ConversationsRepo,
    private readonly agents: AgentsRepo,
    private readonly hub: SseHubService,
    private readonly tools: ToolRegistry,
    private readonly toolParamsProvider: ToolParamsThoughtTypeProvider,
    @Inject(forwardRef(() => ThoughtProcessingService))
    private readonly thoughtProcessing: ThoughtProcessingService,
  ) {}

  buildInputFromConversation = async (conversationId: string): Promise<PlannerInput> => {
    const entries = await this.chatEntries.listChatEntries(conversationId);
    const anchorUserMessage = [...entries].reverse().find((entry) => entry.type === 'user-message');
    if (!anchorUserMessage) throw new Error(`planner requires a user-message in conversation ${conversationId}`);
    const leafEntryId = await this.chatEntries.getActiveLeafEntryId(conversationId);
    if (!leafEntryId) throw new Error(`planner requires an active leaf entry in conversation ${conversationId}`);
    const agentId = anchorUserMessage.agentId;
    const agent = await this.agents.get(agentId);
    if (!agent) throw new Error(`planner agent not found: ${agentId}`);
    return {
      conversationId,
      anchorEntryId: leafEntryId,
      agentId,
      userText: anchorUserMessage.text,
      systemPrompt: agent.system_prompt ?? '',
      enabledToolIds: this.resolveEnabledToolIds(agent),
      entries,
      triggerEntry: anchorUserMessage,
    };
  };

  getLifecycleStartRequest = (input: PlannerInput) => ({
    conversationId: input.conversationId,
    parentId: input.anchorEntryId,
    llmRequest: input.userText,
    kind: 'planner' as const,
    includeAction: true,
    summary: 'Decision planning',
  });

  runPrepare = (input: PlannerInput) => ({
    prompt: buildPlannerPrompt({
      systemPrompt: input.systemPrompt,
      entries: input.entries,
      anchorUserText: input.userText,
      triggerEntry: input.triggerEntry,
      toolIds: input.enabledToolIds,
      priorToolResults: [],
    }),
  });

  onLlmDelta = (input: PlannerInput, lifecycle: ThoughtLifecycleEntries, delta: string): void => {
    if (!delta) return;
    const state = this.ensureState(lifecycle.streamEntryId);
    state.reconstructedReply += delta;

    this.hub.publish(input.conversationId, {
      type: SseType.PLANNER_LLM_STREAM,
      chatEntryId: lifecycle.streamEntryId,
      delta,
    });

    const extracted = extractAssistantOutputFromJsonLike(state.reconstructedReply);
    const answerDelta = incrementalDelta(state.streamedAnswer, extracted);
    if (!answerDelta) return;
    state.streamedAnswer = extracted;
    state.pending = state.pending
      .then(() => this.streamAssistantDelta(state, input.conversationId, lifecycle, answerDelta))
      .catch((error) => {
        this.logger.error(`assistant_stream pipe failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  runDecision = async (
    input: PlannerInput,
    lifecycle: ThoughtLifecycleEntries,
    llmResult: ThoughtReasonLlmResult,
    signal: AbortSignal,
  ): Promise<void> => {
    const state = this.liveStreamState.get(lifecycle.streamEntryId);
    if (state) await state.pending.catch(() => undefined);
    this.liveStreamState.delete(lifecycle.streamEntryId);

    const parsed = parsePlannerOutput(llmResult.fullResponse);
    const requestedToolCalls = parsed.toolRequests.filter((t) => input.enabledToolIds.includes(t.toolName));
    const assistantText = parsed.assistantOutput.trim();
    const action = requestedToolCalls.length > 0 ? 'tool_call' : 'final_answer';
    const parseResult = toPlannerParseResult(parsed);
    const decision = toLlmDecision(parsed, requestedToolCalls);

    await this.persistStreamEntryDecision(lifecycle, llmResult, parseResult, decision);
    const finalAssistantEntryId = await this.finalizeAssistantMessage(state ?? null, input.conversationId, lifecycle, assistantText);
    await this.finalizeThoughtAction(lifecycle, action, assistantText, parseResult);
    this.publishPlannerResponse(lifecycle, llmResult, requestedToolCalls.length, assistantText);
    await publishConversationUpdated(this.hub, this.conversations, input.conversationId);

    if (requestedToolCalls.length === 0) return;
    const agent = await this.agents.get(input.agentId);
    if (!agent) throw new Error(`planner: agent not found for tool execution: ${input.agentId}`);
    const continuationAnchorId = finalAssistantEntryId ?? lifecycle.thoughtActionEntryId ?? lifecycle.streamEntryId;
    for (const requested of requestedToolCalls) {
      signal.throwIfAborted();
      await this.spawnToolParamsThought(
        { input, agent, requested, continuationAnchorId, followup: parsed.followup },
        signal,
      );
    }
  };

  private resolveEnabledToolIds(agent: AgentEntity): string[] {
    const toolsCfg = agent.default_llm_configuration?.tools ?? {};
    return this.tools
      .list()
      .filter((tool) => toolsCfg[tool.getName()]?.enabled === true)
      .map((tool) => tool.getName());
  }

  private async spawnToolParamsThought(
    args: {
      input: PlannerInput;
      agent: AgentEntity;
      requested: { toolName: string; toolRequest: string };
      continuationAnchorId: string;
      followup: 'continue' | 'finalize';
    },
    signal: AbortSignal,
  ): Promise<void> {
    const tool = this.tools.get(args.requested.toolName);
    if (!tool) throw new Error(`planner tool request references missing tool: ${args.requested.toolName}`);
    const toolParamsInput: ToolParamsInput = {
      conversationId: args.input.conversationId,
      sourceEntryId: args.continuationAnchorId,
      agentId: args.input.agentId,
      toolName: args.requested.toolName,
      toolAiDescription: tool.getAiDescription(),
      toolParamsSchema: tool.getParamsSchema(),
      toolRequest: args.requested.toolRequest,
      plannerFollowup: { mode: args.followup },
    };
    const toolCfg = args.agent.default_llm_configuration?.tools?.[args.requested.toolName];
    if (toolCfg) toolParamsInput.agentToolConfig = toolCfg;
    await this.thoughtProcessing.runThoughtWithInput(this.toolParamsProvider, toolParamsInput, signal);
  }

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

  private async streamAssistantDelta(
    state: StreamState,
    conversationId: string,
    lifecycle: ThoughtLifecycleEntries,
    delta: string,
  ): Promise<void> {
    if (!state.assistantEntryId) {
      const created = await this.chatEntries.appendAssistantMessage(conversationId, {
        text: '',
        parentId: lifecycle.thoughtActionEntryId ?? null,
      });
      state.assistantEntryId = created.id;
      const upsert = await this.chatEntries.getChatEntry(conversationId, created.id);
      if (upsert) this.hub.publish(conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry: upsert });
    }
    const payload: { type: typeof SseType.ASSISTANT_STREAM; chatEntryId: string; delta: string; parentId?: string } = {
      type: SseType.ASSISTANT_STREAM,
      chatEntryId: state.assistantEntryId,
      delta,
    };
    if (lifecycle.thoughtActionEntryId) payload.parentId = lifecycle.thoughtActionEntryId;
    this.hub.publish(conversationId, payload);
  }

  private async finalizeAssistantMessage(
    state: StreamState | null,
    conversationId: string,
    lifecycle: ThoughtLifecycleEntries,
    assistantText: string,
  ): Promise<string | null> {
    if (!assistantText) return state?.assistantEntryId ?? null;
    if (state?.assistantEntryId) {
      await this.chatEntries.updateAssistantMessage(conversationId, { id: state.assistantEntryId, text: assistantText });
      const entry = await this.chatEntries.getChatEntry(conversationId, state.assistantEntryId);
      if (entry) this.hub.publish(conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry });
      return state.assistantEntryId;
    }
    const created = await this.chatEntries.appendAssistantMessage(conversationId, {
      text: assistantText,
      parentId: lifecycle.thoughtActionEntryId ?? null,
    });
    const entry = await this.chatEntries.getChatEntry(conversationId, created.id);
    if (entry) this.hub.publish(conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry });
    return created.id;
  }

  private async persistStreamEntryDecision(
    lifecycle: ThoughtLifecycleEntries,
    llmResult: ThoughtReasonLlmResult,
    parseResult: PlannerParseResult,
    decision: LlmDecision | null,
  ): Promise<void> {
    const usage = llmResult.usage;
    const patch: Record<string, unknown> = { parseResult, decision };
    if (usage) {
      patch.promptTokens = usage.promptTokens;
      patch.completionTokens = usage.completionTokens;
      if (typeof usage.cachedPromptTokens === 'number') patch.cachedPromptTokens = usage.cachedPromptTokens;
    }
    await this.chatEntries.mergeEntryPayload(lifecycle.conversationId, lifecycle.streamEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, lifecycle.conversationId, lifecycle.streamEntryId);
  }

  private async finalizeThoughtAction(
    lifecycle: ThoughtLifecycleEntries,
    action: 'tool_call' | 'final_answer',
    assistantText: string,
    parseResult: PlannerParseResult,
  ): Promise<void> {
    if (!lifecycle.thoughtActionEntryId) return;
    const summary = action === 'tool_call' ? 'Queued tool call(s)' : assistantText || 'Completed';
    await this.chatEntries.updateThoughtAction(lifecycle.conversationId, lifecycle.thoughtActionEntryId, {
      status: 'completed',
      summary,
      action,
    });
    await this.chatEntries.mergeEntryPayload(lifecycle.conversationId, lifecycle.thoughtActionEntryId, { parseResult });
    await publishChatEntryUpsert(this.hub, this.chatEntries, lifecycle.conversationId, lifecycle.thoughtActionEntryId);
  }

  private publishPlannerResponse(
    lifecycle: ThoughtLifecycleEntries,
    llmResult: ThoughtReasonLlmResult,
    toolCallCount: number,
    assistantText: string,
  ): void {
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
      chatEntryId: lifecycle.streamEntryId,
      summary: toolCallCount > 0 ? `Queued ${toolCallCount} tool call(s)` : assistantText || 'Completed',
      finished: true,
      action: toolCallCount > 0 ? 'tool_call' : 'final_answer',
    };
    if (llmResult.providerId) payload.llmProviderId = llmResult.providerId;
    if (llmResult.model) payload.llmModel = llmResult.model;
    if (llmResult.usage) {
      payload.promptTokens = llmResult.usage.promptTokens;
      payload.completionTokens = llmResult.usage.completionTokens;
      if (typeof llmResult.usage.cachedPromptTokens === 'number') {
        payload.cachedPromptTokens = llmResult.usage.cachedPromptTokens;
      }
    }
    this.hub.publish(lifecycle.conversationId, payload);
  }
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
