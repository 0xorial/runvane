import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import type { AgentEntity, AgentToolConfig } from '../../agents/agent.entity.js';
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
import type { LlmCompletion, LlmRequest, LlmStreamEvent, LlmToolSpec } from '../../llmProviders/types.js';
import { resolveSeparateParamsResolution, resolveToolConfig } from '../../tools/resolve-tool-config.js';
import { ToolRegistry } from '../../tools/tool-registry.js';
import { stripPrepareInputJson } from '../inputSnapshot.js';
import { buildAskAttachmentParamsContext } from '../lib/toolParamsPrompt.js';
import { buildPlannerMessages, describeToolChange, extractToolOperations, type PlannerToolInfo } from '../lib/plannerPrompt.js';
import {
  extractAssistantOutputFromJsonLike,
  parsePlannerCompletion,
  type ParsedPlannerOutput,
} from '../lib/plannerTextParsing.js';
import { ThoughtProcessingService } from '../thought-processing.service.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';
import { ToolParamsThoughtTypeProvider, type ToolParamsInput } from './toolParamsProvider.js';

export type PlannerInput = {
  conversationId: string;
  agentId: string;
  systemPrompt: string;
  enabledToolIds: string[];
  entries: ChatEntry[];
  toolOverrides?: Record<string, AgentToolConfig>;
  /** Set when this turn's available tools differ from the previous user turn. */
  toolChangeNote?: string;
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
  readonly thoughtType = 'planner' as const;
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

  buildInputFromConversation = async (conversationId: string, leafEntryId: string): Promise<PlannerInput> => {
    const entries = (await this.chatEntries.listChatEntriesFromLeaf(conversationId, leafEntryId)).map(
      stripPrepareInputJson,
    );
    const anchorUserMessage = [...entries].reverse().find((entry) => entry.type === 'user-message');
    if (!anchorUserMessage) throw new Error(`planner requires a user-message in conversation ${conversationId}`);
    const agentId = anchorUserMessage.agentId;
    const agent = await this.agents.get(agentId);
    if (!agent) throw new Error(`planner agent not found: ${agentId}`);
    const toolOverrides = anchorUserMessage.overrides?.tools;
    const enabledToolIds = this.resolveEnabledToolIds(agent, toolOverrides);
    const toolChangeNote = await this.computeToolChangeNote(entries, agent, enabledToolIds);
    return {
      conversationId,
      agentId,
      systemPrompt: agent.system_prompt ?? '',
      enabledToolIds,
      entries,
      ...(toolOverrides ? { toolOverrides } : {}),
      ...(toolChangeNote ? { toolChangeNote } : {}),
    };
  };

  /**
   * Compare this turn's available tools with the previous user turn's; if they
   * differ, return a note for the planner. Diffs the *effective* enabled set, so
   * a flip-and-back (off then on) nets to no change and produces no note.
   */
  private computeToolChangeNote = async (
    entries: ChatEntry[],
    currentAgent: AgentEntity,
    currentEnabled: string[],
  ): Promise<string | undefined> => {
    const userIdxs = entries.flatMap((entry, i) => (entry.type === 'user-message' ? [i] : []));
    if (userIdxs.length < 2) return undefined; // no previous turn to compare against
    const prev = entries[userIdxs[userIdxs.length - 2]!];
    if (prev.type !== 'user-message') return undefined;
    const prevAgent = prev.agentId === currentAgent.id ? currentAgent : await this.agents.get(prev.agentId);
    if (!prevAgent) return undefined;
    const previousEnabled = this.resolveEnabledToolIds(prevAgent, prev.overrides?.tools);
    return describeToolChange(previousEnabled, currentEnabled);
  };

  runPrepare = (input: PlannerInput): LlmRequest => {
    const toolSpecs = this.buildToolSpecs(input.enabledToolIds);
    return {
      messages: buildPlannerMessages({
        systemPrompt: input.systemPrompt,
        entries: input.entries,
        tools: this.describeToolsForPlanner(input.enabledToolIds),
        ...(input.toolChangeNote ? { toolChangeNote: input.toolChangeNote } : {}),
      }),
      // Declare the enabled tools natively. We render prior tool calls as native
      // tool_call/tool_result blocks in history, and Anthropic (via OpenRouter)
      // requires the matching tools to be declared or it returns an empty turn
      // on the post-tool continuation.
      ...(toolSpecs.length > 0 ? { tools: toolSpecs } : {}),
    };
  };

  // Native tool specs for the request (name + description + JSON-Schema params),
  // so history tool_call blocks are anchored to a declared tool.
  private buildToolSpecs(enabledToolIds: string[]): LlmToolSpec[] {
    const specs: LlmToolSpec[] = [];
    for (const name of enabledToolIds) {
      const tool = this.tools.get(name);
      if (!tool) continue;
      specs.push({ name, description: tool.getAiDescription(), paramsSchema: tool.getParamsSchema() });
    }
    return specs;
  }

  // Enrich the bare enabled-tool names with each tool's model-facing
  // description and dispatch operations, so the planner can select tools (and
  // operations) deliberately rather than guessing from the name alone.
  private describeToolsForPlanner(enabledToolIds: string[]): PlannerToolInfo[] {
    return enabledToolIds.map((name) => {
      const tool = this.tools.get(name);
      return {
        name,
        description: tool?.getAiDescription() ?? '',
        operations: tool ? extractToolOperations(tool.getParamsSchema()) : [],
      };
    });
  }

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

    const parsed = parsePlannerCompletion(completion, (raw) =>
      this.logger.warn(`planner JSON parse failed — treating reply as plain text (${raw.length} chars)`),
    );
    // Route every call to a *real* tool through RunToolService — including tools
    // the agent set to `off` (not in `enabledToolIds`, so never advertised in the
    // prompt). RunToolService denies an `off` tool with a visible forbid error
    // rather than the call being silently dropped. Only names that match no
    // registered tool are ignored.
    const requestedToolCalls = parsed.toolRequests.filter((t) => this.tools.get(t.toolName) != null);
    const assistantText = parsed.assistantOutput.trim();
    const action = requestedToolCalls.length > 0 ? 'tool_call' : 'final_answer';
    const parseResult = toPlannerParseResult(parsed);
    const decision = toLlmDecision(parsed, requestedToolCalls);

    await this.persistStreamEntryDecision(ctx, completion, parseResult, decision);
    const assistantEntryId = await this.finalizeAssistantMessage(state ?? null, ctx, assistantText);
    await this.finalizeThoughtAction(ctx, action, assistantText, parseResult);
    if (action === 'final_answer' && assistantEntryId) {
      await this.chatEntries.setDefaultViewLeaf(input.conversationId, assistantEntryId);
    }
    await publishConversationUpdated(this.hub, this.conversations, this.chatEntries, input.conversationId);

    if (requestedToolCalls.length === 0) return;
    const agent = await this.agents.get(input.agentId);
    if (!agent) throw new Error(`planner: agent not found for tool execution: ${input.agentId}`);
    // One fan-out batch for this decision: the planner continues only after all
    // `size` tools reach a terminal state (RunToolService.memberResolved).
    const toolBatch = { id: crypto.randomUUID(), size: requestedToolCalls.length };
    for (const requested of requestedToolCalls) {
      scope.throwIfAborted();
      this.startToolParamsThought({ input, agent, requested, followup: parsed.followup, toolBatch }, ctx, scope);
    }
  };

  private resolveEnabledToolIds(agent: AgentEntity, toolOverrides?: Record<string, AgentToolConfig>): string[] {
    return this.tools
      .list()
      .filter((tool) => {
        const policy = resolveToolConfig(agent, toolOverrides, tool.getName()).policy;
        return policy != null && policy !== 'off';
      })
      .map((tool) => tool.getName());
  }

  private startToolParamsThought(
    args: {
      input: PlannerInput;
      agent: AgentEntity;
      requested: { toolName: string; toolRequest: string };
      followup: 'continue' | 'finalize';
      toolBatch: { id: string; size: number };
    },
    ctx: ThoughtContext,
    scope: LifecycleScope,
  ): void {
    const tool = this.tools.get(args.requested.toolName);
    if (!tool) throw new Error(`planner tool request references missing tool: ${args.requested.toolName}`);
    const mergedToolCfg = resolveToolConfig(args.agent, args.input.toolOverrides, args.requested.toolName);
    const paramsContextNote =
      args.requested.toolName === 'ask_attachment'
        ? buildAskAttachmentParamsContext(args.input.entries)
        : undefined;
    const toolParamsInput: ToolParamsInput = {
      conversationId: args.input.conversationId,
      agentId: args.input.agentId,
      toolName: args.requested.toolName,
      toolAiDescription: tool.getAiDescription(),
      toolParamsSchema: tool.getParamsSchema(),
      toolRequest: args.requested.toolRequest,
      plannerFollowup: { mode: args.followup },
      toolBatch: args.toolBatch,
      ...(paramsContextNote ? { paramsContextNote } : {}),
      ...(args.input.toolOverrides ? { toolOverrides: args.input.toolOverrides } : {}),
    };
    const rawGuardrail = args.agent.default_llm_configuration?.guardrail;
    if (mergedToolCfg.guardrail === true && rawGuardrail?.provider_id && rawGuardrail?.model_name) {
      const toolPromptOverride = mergedToolCfg.guardrail_system_prompt?.trim();
      const basePrompt = rawGuardrail.system_prompt ?? '';
      toolParamsInput.guardrailConfig = {
        provider_id: rawGuardrail.provider_id,
        model_name: rawGuardrail.model_name,
        system_prompt: toolPromptOverride || basePrompt,
      };
    }
    const separateParamsResolution = resolveSeparateParamsResolution(
      args.agent,
      args.input.toolOverrides,
      args.requested.toolName,
    );
    if (separateParamsResolution) {
      this.thoughtProcessing.startThought({
        provider: this.toolParamsProvider,
        conversationId: toolParamsInput.conversationId,
        scope,
        chain: ctx.chain,
        // Tool-param resolution + the post-tool planner continuation run on the
        // downstream model, which equals ctx.llm except for a "just this call"
        // model override.
        llm: ctx.downstreamLlm,
        input: toolParamsInput,
      });
      return;
    }
    // separate_params_resolution is off for this tool: skip the extra LLM call
    // and parse the planner's own tool request directly as the params JSON.
    this.thoughtProcessing.startThoughtWithoutLlm({
      provider: this.toolParamsProvider,
      conversationId: toolParamsInput.conversationId,
      scope,
      chain: ctx.chain,
      llm: ctx.downstreamLlm,
      input: toolParamsInput,
      responseText: args.requested.toolRequest,
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

  private async streamAssistantDelta(state: StreamState, ctx: ThoughtContext, delta: string): Promise<void> {
    const conversationId = ctx.conversationId;
    if (!state.assistantEntryId) {
      const created = await ctx.chain.append(ctx.thoughtId, (parentId) =>
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
      await this.chatEntries.updateAssistantMessage(conversationId, {
        id: state.assistantEntryId,
        text: assistantText,
      });
      const entry = await this.chatEntries.getChatEntry(conversationId, state.assistantEntryId);
      if (entry) this.hub.publish(conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry });
      return state.assistantEntryId;
    }
    const created = await ctx.chain.append(ctx.thoughtId, (parentId) =>
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
    // Custom summary/action only — status is flipped by DecisionStep.
    await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
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
