import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishStreamFieldDelta } from '../../sse/sse-helpers.js';
import { getCompletionText } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import { RunToolService, type ToolBatchRef } from '../../tools/run-tool.service.js';
import type { AgentToolConfig } from '../../agents/agent.entity.js';
import type { GuardrailConfig } from '../../contracts/guardrail.js';
import { buildToolParamsMessages, parseToolParamsJson } from '../lib/toolParamsPrompt.js';
import type { LlmRef, ThoughtContext, ThoughtTypeProvider } from '../types.js';
import { GuardrailThoughtTypeProvider } from './guardrailProvider.js';

export type ToolParamsInput = {
  conversationId: string;
  agentId: string;
  toolName: string;
  /** The pre-created spine entry this member updates through its lifecycle. */
  toolEntryId: string;
  toolAiDescription: string;
  toolParamsSchema: unknown;
  toolRequest: string;
  plannerFollowup: { mode: 'continue' | 'finalize' };
  toolBatch?: ToolBatchRef;
  paramsContextNote?: string;
  guardrailConfig?: GuardrailConfig;
  toolOverrides?: Record<string, AgentToolConfig>;
};

@Injectable()
export class ToolParamsThoughtTypeProvider implements ThoughtTypeProvider<ToolParamsInput> {
  readonly thoughtType = 'tool_params' as const;
  readonly prepareTitle = 'Resolve tool parameters';
  private readonly logger = new Logger(ToolParamsThoughtTypeProvider.name);

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: SseHubService,
    @Inject(forwardRef(() => RunToolService))
    private readonly runTool: RunToolService,
    @Inject(forwardRef(() => GuardrailThoughtTypeProvider))
    private readonly guardrailProvider: GuardrailThoughtTypeProvider,
  ) {}

  runPrepare = (input: ToolParamsInput): LlmRequest => ({
    messages: buildToolParamsMessages({
      toolName: input.toolName,
      toolAiDescription: input.toolAiDescription,
      toolParamsSchema: input.toolParamsSchema,
      toolRequest: input.toolRequest,
      ...(input.paramsContextNote ? { paramsContextNote: input.paramsContextNote } : {}),
    }),
  });

  onLlmEvent = (_input: ToolParamsInput, ctx: ThoughtContext, event: LlmStreamEvent): void => {
    if (!ctx.streamEntryId) return;
    publishStreamFieldDelta(this.hub, ctx.conversationId, ctx.streamEntryId, event);
  };

  runDecision = async (
    input: ToolParamsInput,
    ctx: ThoughtContext,
    completion: LlmCompletion,
    scope: LifecycleScope,
  ): Promise<void> => {
    let parsedParams: Record<string, unknown>;
    try {
      parsedParams = parseToolParamsJson(
        getCompletionText(completion),
        input.toolName,
        `tool resolver response for ${input.toolName}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.markActionFailed(ctx, detail);
      // Fan-in counts TERMINAL member entries against the batch size, so every
      // member's pre-created entry must reach a terminal state — an unresolved
      // member would strand the batch.
      await this.failMemberVisible(input, `The tool-parameter resolver failed: ${detail}`, {}, scope, ctx.llm);
      throw new Error(`toolParams: ${detail}`, { cause: error });
    }

    await this.markActionCompleted(ctx, input.toolName, parsedParams);

    try {
      await this.dispatchResolvedParams({
        input,
        params: parsedParams,
        llm: ctx.llm,
        scope,
      });
    } catch (error) {
      scope.throwIfAborted();
      this.logger.warn(`dispatch of resolved '${input.toolName}' params failed: ${String(error)}`);
      if ((error as { toolEntryId?: string }).toolEntryId) {
        // run() already persisted the visible error on the entry — just resolve the member.
        this.runTool.resolveFailedToolParamsMember({
          conversationId: input.conversationId,
          toolEntryId: input.toolEntryId,
          plannerFollowup: input.plannerFollowup,
          scope,
          llm: ctx.llm,
          ...(input.toolBatch ? { toolBatch: input.toolBatch } : {}),
        });
        return;
      }
      await this.failMemberVisible(
        input,
        `Tool arguments were rejected: ${String(error)}`,
        parsedParams,
        scope,
        ctx.llm,
      );
    }
  };

  /** Mark the member's pre-created entry terminally failed and resolve its batch slot. */
  private async failMemberVisible(
    input: ToolParamsInput,
    reason: string,
    params: Record<string, unknown>,
    scope: LifecycleScope,
    llm: LlmRef,
  ): Promise<void> {
    await this.runTool
      .failDirectDispatch({
        input: {
          conversationId: input.conversationId,
          agentId: input.agentId,
          toolName: input.toolName,
          toolEntryId: input.toolEntryId,
          params,
          toolRequest: input.toolRequest,
          plannerFollowup: input.plannerFollowup,
          ...(input.toolBatch ? { toolBatch: input.toolBatch } : {}),
          ...(input.toolOverrides ? { toolOverrides: input.toolOverrides } : {}),
        },
        reason,
        scope,
        llm,
      })
      .catch((error) => {
        this.logger.error(`failDirectDispatch for '${input.toolName}' failed: ${String(error)}`);
      });
  }

  /**
   * Direct dispatch for tools whose `separate_params_resolution` is OFF: the
   * resolution step does not exist, so NO tool_params thought is created —
   * the planner's tool_request must itself be the JSON args, and the tool
   * invocation hangs off the deciding (planner) thought. A tool_request that
   * doesn't parse as JSON breaks the direct-params contract: the batch member
   * resolves as failed so the planner continuation isn't stranded.
   */
  startDirect(args: {
    input: ToolParamsInput;
    llm: LlmRef;
    scope: LifecycleScope;
  }): void {
    const { input, llm, scope } = args;
    // A failed direct dispatch must leave a visible, terminal error entry: a
    // bare batch-member resolution replans with an UNCHANGED context, and the
    // model just re-emits the same rejected call — an invisible, token-burning
    // loop (glm-5.2 once did 15 rounds of it).

    let params: Record<string, unknown>;
    try {
      params = parseToolParamsJson(
        input.toolRequest,
        input.toolName,
        `direct tool params for ${input.toolName}`,
      );
    } catch (error) {
      // Normally unreachable: the planner falls back to the resolution thought
      // for non-JSON direct params before calling startDirect.
      this.logger.warn(
        `direct params for '${input.toolName}' are not valid JSON (separate_params_resolution is off): ${String(error)}`,
      );
      void this.failMemberVisible(
        input,
        `The planner's arguments for '${input.toolName}' are not valid JSON (separate_params_resolution is off): ${String(error)}`,
        {},
        scope,
        llm,
      );
      return;
    }
    scope.spawn(async () => {
      try {
        await this.dispatchResolvedParams({ input, params, llm, scope });
      } catch (error) {
        scope.throwIfAborted();
        this.logger.warn(`direct dispatch of '${input.toolName}' failed: ${String(error)}`);
        if ((error as { toolEntryId?: string }).toolEntryId) {
          // run() already persisted the visible error on the entry — just resolve the member.
          this.runTool.resolveFailedToolParamsMember({
            conversationId: input.conversationId,
            toolEntryId: input.toolEntryId,
            plannerFollowup: input.plannerFollowup,
            scope,
            llm,
            ...(input.toolBatch ? { toolBatch: input.toolBatch } : {}),
          });
          return;
        }
        await this.failMemberVisible(
          input,
          `Tool arguments were rejected: ${String(error)}`,
          params,
          scope,
          llm,
        );
      }
    });
  }

  /** Thought-independent tail of params resolution: guardrail (when
   *  configured) or straight tool run. The only two callers are runDecision
   *  (resolution thought) and startDirect (no thought), so their behavior
   *  can't drift apart. */
  private async dispatchResolvedParams(args: {
    input: ToolParamsInput;
    params: Record<string, unknown>;
    llm: LlmRef;
    scope: LifecycleScope;
  }): Promise<void> {
    const { input, params, llm, scope } = args;
    if (input.guardrailConfig) {
      // Delegate to GuardrailThoughtTypeProvider so the guardrail LLM call is
      // visible as a side thought anchored to the tool entry it vets.
      this.guardrailProvider.start({
        input: {
          conversationId: input.conversationId,
          agentId: input.agentId,
          toolName: input.toolName,
          toolEntryId: input.toolEntryId,
          params,
          toolRequest: input.toolRequest,
          guardrailConfig: input.guardrailConfig,
          plannerFollowup: input.plannerFollowup,
          mainLlm: llm,
          ...(input.toolBatch ? { toolBatch: input.toolBatch } : {}),
          ...(input.toolOverrides ? { toolOverrides: input.toolOverrides } : {}),
        },
        scope,
      });
      return;
    }

    await this.runTool.run(
      {
        conversationId: input.conversationId,
        agentId: input.agentId,
        toolName: input.toolName,
        toolEntryId: input.toolEntryId,
        params,
        toolRequest: input.toolRequest,
        plannerFollowup: input.plannerFollowup,
        ...(input.toolBatch ? { toolBatch: input.toolBatch } : {}),
        ...(input.toolOverrides ? { toolOverrides: input.toolOverrides } : {}),
      },
      scope,
      llm,
    );
  }

  private async markActionCompleted(
    ctx: ThoughtContext,
    toolName: string,
    parsedParams: Record<string, unknown>,
  ): Promise<void> {
    if (!ctx.thoughtActionEntryId) return;
    // Custom summary/action only — status is flipped by DecisionStep.
    await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
      summary: `Resolved parameters for ${toolName}`,
      action: 'tool_call',
      toolName,
    });
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, ctx.thoughtActionEntryId, {
      resolvedParameters: parsedParams,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtActionEntryId);
  }

  private async markActionFailed(ctx: ThoughtContext, detail: string): Promise<void> {
    if (!ctx.thoughtActionEntryId) return;
    await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
      status: 'failed',
      summary: detail,
      action: 'failed',
      error: detail,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtActionEntryId);
  }
}
