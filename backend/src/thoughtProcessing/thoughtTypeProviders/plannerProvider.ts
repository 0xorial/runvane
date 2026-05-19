import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import type { AgentEntity } from '../../agents/agent.entity.js';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import type { AgenticPlannerOutput, ChatEntry, LlmDecision } from '../../contracts/chatEntry.js';
import { SseType } from '../../contracts/sse.js';
import { AgentsRepo } from '../../db/repositories/agents.repo.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../db/repositories/conversations.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import {
  incrementalDelta,
  publishChatEntryUpsert,
  publishConversationUpdated,
  publishStreamFieldDelta,
} from '../../sse/sse-helpers.js';
import { getCompletionText } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import { ToolRegistry } from '../../tools/tool-registry.js';
import { buildPlannerMessages } from '../lib/plannerPrompt.js';
import { extractAssistantOutputFromJsonLike, parsePlannerOutput, type ParsedPlannerOutput } from '../lib/plannerTextParsing.js';
import { ThoughtProcessingService } from '../thought-processing.service.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';
import { ToolParamsThoughtTypeProvider, type ToolParamsInput } from './toolParamsProvider.js';

export type PlannerInput = {
  conversationId: string;
  agentId: string;
  systemPrompt: string;
  enabledToolIds: string[];
  entries: ChatEntry[];
};

type StreamState = {
  reconstructedReply: string;
  streamedAnswer: string;
  assistantEntryId: string | null;
  pending: Promise<void>;
};

type PlannerParseResult = { status: 'ok'; parsed: AgenticPlannerOutput };

@Injectable()
export class PlannerThoughtTypeProvider implements ThoughtTypeProvider<PlannerInput> {
  readonly streamEntryType = 'planner_llm_stream' as const;
  readonly wantsAction = true;
  readonly prepareTitle = 'Decision planning';
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
    const agentId = anchorUserMessage.agentId;
    const agent = await this.agents.get(agentId);
    if (!agent) throw new Error(`planner agent not found: ${agentId}`);
    return {
      conversationId,
      agentId,
      systemPrompt: agent.system_prompt ?? '',
      enabledToolIds: this.resolveEnabledToolIds(agent),
      entries,
    };
  };

  runPrepare = (input: PlannerInput): LlmRequest => ({
    messages: buildPlannerMessages({
      systemPrompt: input.systemPrompt,
      entries: input.entries,
      toolIds: input.enabledToolIds,
    }),
  });

  onLlmEvent = (input: PlannerInput, ctx: ThoughtContext, event: LlmStreamEvent): void => {
    if (!ctx.streamEntryId) return;
    if (!publishStreamFieldDelta(this.hub, input.conversationId, ctx.streamEntryId, event)) return;
    if (event.type !== 'text_delta') return;
    // Only the visible answer (text_delta) feeds the live assistant-message
    // mirror; thinking_delta is surfaced on the stream entry alone.
    const streamEntryId = ctx.streamEntryId;
    const state = this.ensureState(streamEntryId);
    state.reconstructedReply += event.delta;

    const extracted = extractAssistantOutputFromJsonLike(state.reconstructedReply);
    const answerDelta = incrementalDelta(state.streamedAnswer, extracted);
    if (!answerDelta) return;
    state.streamedAnswer = extracted;
    state.pending = state.pending
      .then(() => this.streamAssistantDelta(state, ctx, answerDelta))
      .catch((error) => {
        this.logger.error(`assistant_stream pipe failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  runDecision = async (
    input: PlannerInput,
    ctx: ThoughtContext,
    completion: LlmCompletion,
    scope: LifecycleScope,
  ): Promise<void> => {
    if (!ctx.streamEntryId) throw new Error('planner runDecision requires ctx.streamEntryId');
    const streamEntryId = ctx.streamEntryId;
    const state = this.liveStreamState.get(streamEntryId);
    if (state) await state.pending.catch(() => undefined);
    this.liveStreamState.delete(streamEntryId);

    const parsed = parsePlannerOutput(getCompletionText(completion), (raw) =>
      this.logger.warn(`planner JSON parse failed — treating reply as plain text (${raw.length} chars)`),
    );
    const requestedToolCalls = parsed.toolRequests.filter((t) => input.enabledToolIds.includes(t.toolName));
    const assistantText = parsed.assistantOutput.trim();
    const action = requestedToolCalls.length > 0 ? 'tool_call' : 'final_answer';
    const parseResult = toPlannerParseResult(parsed);
    const decision = toLlmDecision(parsed, requestedToolCalls);

    await this.persistStreamEntryDecision(ctx, completion, parseResult, decision);
    await this.finalizeAssistantMessage(state ?? null, ctx, assistantText);
    await this.finalizeThoughtAction(ctx, action, assistantText, parseResult);
    await publishConversationUpdated(this.hub, this.conversations, input.conversationId);

    if (requestedToolCalls.length === 0) return;
    const agent = await this.agents.get(input.agentId);
    if (!agent) throw new Error(`planner: agent not found for tool execution: ${input.agentId}`);
    for (const requested of requestedToolCalls) {
      scope.throwIfAborted();
      this.startToolParamsThought({ input, agent, requested, followup: parsed.followup }, ctx, scope);
    }
  };

  private resolveEnabledToolIds(agent: AgentEntity): string[] {
    const toolsCfg = agent.default_llm_configuration?.tools ?? {};
    return this.tools
      .list()
      .filter((tool) => toolsCfg[tool.getName()]?.enabled === true)
      .map((tool) => tool.getName());
  }

  private startToolParamsThought(
    args: {
      input: PlannerInput;
      agent: AgentEntity;
      requested: { toolName: string; toolRequest: string };
      followup: 'continue' | 'finalize';
    },
    ctx: ThoughtContext,
    scope: LifecycleScope,
  ): void {
    const tool = this.tools.get(args.requested.toolName);
    if (!tool) throw new Error(`planner tool request references missing tool: ${args.requested.toolName}`);
    const toolParamsInput: ToolParamsInput = {
      conversationId: args.input.conversationId,
      agentId: args.input.agentId,
      toolName: args.requested.toolName,
      toolAiDescription: tool.getAiDescription(),
      toolParamsSchema: tool.getParamsSchema(),
      toolRequest: args.requested.toolRequest,
      plannerFollowup: { mode: args.followup },
    };
    const toolCfg = args.agent.default_llm_configuration?.tools?.[args.requested.toolName];
    if (toolCfg) toolParamsInput.agentToolConfig = toolCfg;
    const rawGuardrail = args.agent.default_llm_configuration?.guardrail;
    if (rawGuardrail?.provider_id && rawGuardrail?.model_name) {
      // Per-tool system_prompt overrides the global one; fall back to global.
      const toolPromptOverride = toolCfg?.guardrail_system_prompt?.trim();
      const basePrompt = rawGuardrail.system_prompt ?? '';
      toolParamsInput.guardrailConfig = {
        provider_id: rawGuardrail.provider_id,
        model_name: rawGuardrail.model_name,
        system_prompt: toolPromptOverride || basePrompt,
      };
    }
    this.thoughtProcessing.startThought({
      provider: this.toolParamsProvider,
      conversationId: toolParamsInput.conversationId,
      scope,
      chain: ctx.chain,
      llm: { providerId: ctx.llmProviderId, model: ctx.llmModel },
      input: toolParamsInput,
    });
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
    ctx: ThoughtContext,
    delta: string,
  ): Promise<void> {
    const conversationId = ctx.conversationId;
    if (!state.assistantEntryId) {
      const created = await ctx.chain.append((parentId) =>
        this.chatEntries.appendAssistantMessage(conversationId, { text: '', parentId }),
      );
      state.assistantEntryId = created.id;
      const upsert = await this.chatEntries.getChatEntry(conversationId, created.id);
      if (upsert) this.hub.publish(conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry: upsert });
    }
    this.hub.publish(conversationId, {
      type: SseType.CHAT_ENTRY_DELTA,
      chatEntryId: state.assistantEntryId,
      field: 'text',
      delta,
    });
  }

  private async finalizeAssistantMessage(
    state: StreamState | null,
    ctx: ThoughtContext,
    assistantText: string,
  ): Promise<string | null> {
    const conversationId = ctx.conversationId;
    if (!assistantText) return state?.assistantEntryId ?? null;
    if (state?.assistantEntryId) {
      await this.chatEntries.updateAssistantMessage(conversationId, { id: state.assistantEntryId, text: assistantText });
      const entry = await this.chatEntries.getChatEntry(conversationId, state.assistantEntryId);
      if (entry) this.hub.publish(conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry });
      return state.assistantEntryId;
    }
    const created = await ctx.chain.append((parentId) =>
      this.chatEntries.appendAssistantMessage(conversationId, { text: assistantText, parentId }),
    );
    const entry = await this.chatEntries.getChatEntry(conversationId, created.id);
    if (entry) this.hub.publish(conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry });
    return created.id;
  }

  private async persistStreamEntryDecision(
    ctx: ThoughtContext,
    completion: LlmCompletion,
    parseResult: PlannerParseResult,
    decision: LlmDecision | null,
  ): Promise<void> {
    if (!ctx.streamEntryId) throw new Error('persistStreamEntryDecision requires ctx.streamEntryId');
    const patch: Record<string, unknown> = { parseResult, decision };
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, ctx.streamEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.streamEntryId);
  }

  private async finalizeThoughtAction(
    ctx: ThoughtContext,
    action: 'tool_call' | 'final_answer',
    assistantText: string,
    parseResult: PlannerParseResult,
  ): Promise<void> {
    if (!ctx.thoughtActionEntryId) return;
    const summary = action === 'tool_call' ? 'Queued tool call(s)' : assistantText || 'Completed';
    await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
      status: 'completed',
      summary,
      action,
    });
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, ctx.thoughtActionEntryId, { parseResult });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtActionEntryId);
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
