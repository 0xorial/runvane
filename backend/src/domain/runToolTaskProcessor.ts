import type { ChatEntriesRepo } from "../infra/repositories/chatEntriesRepo.js";
import type { LlmProviderSettingsRepo } from "../infra/repositories/llmProviderSettingsRepo.js";
import type { ToolExecutionLogsRepo } from "../infra/repositories/toolExecutionLogsRepo.js";
import type { TasksRepo } from "../infra/repositories/tasksRepo.js";
import { logger } from "../infra/logger.js";
import { SseType } from "../types/sse.js";
import type { ToolInvocationEntry } from "../types/chatEntry.js";
import type { RunToolTask } from "./agentTask.js";
import type { ConversationEventHub } from "../events/conversationEventHub.js";
import { mostPermissivePermission } from "../tools/baseTool.js";
import type { ToolRegistry } from "../tools/toolRegistry.js";
import {
  composeFailedPlannerResponse,
  parseJsonObjectFromCompletionText,
  usageFromStreamingError,
} from "./continueConversationTaskProcessor.helpers.js";
import { isTaskCancelledError, throwIfCancelled } from "./taskCancellation.js";

type ToolExecutionEnvelope = {
  ok: boolean;
  toolId: string;
  output: unknown;
  error: string | null;
  permission_state: "allow" | "ask_user" | "forbid";
  timing: { started_at: string; finished_at: string; elapsed_ms: number };
};

export class RunToolTaskProcessor {
  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: ConversationEventHub,
    private readonly tools: ToolRegistry,
    private readonly toolExecutionLogs: ToolExecutionLogsRepo,
    private readonly tasks: TasksRepo,
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly enqueueContinueConversation: (conversationId: string) => { taskId: number },
  ) {}

  async process(task: RunToolTask, taskId?: number, opts?: { shouldCancel?: () => boolean }): Promise<void> {
    const conversationId = task.conversationId;
    throwIfCancelled(opts?.shouldCancel);
    const startedAt = new Date();
    const startedAtMs = startedAt.getTime();
    const argsPreview = safeStringify(task.params);
    const batchId = typeof task.batchId === "string" && task.batchId.trim().length > 0 ? task.batchId.trim() : null;
    const hasPendingBatchTools = (): boolean =>
      batchId !== null ? this.tasks.hasUnfinishedRunToolTasksInBatch(batchId, taskId) : false;
    const existingEntry = this.findPendingToolInvocationEntry(conversationId, task);
    let toolEntryId = existingEntry?.id ?? "";
    if (!task.toolRequest && !toolEntryId) {
      const created = this.chatEntries.appendToolInvocation(conversationId, {
        toolId: task.toolName,
        state: "running",
        parameters:
          task.params && typeof task.params === "object" && !Array.isArray(task.params)
            ? (task.params as Record<string, unknown>)
            : { raw: task.params },
        result: null,
      });
      toolEntryId = created.id;
      this.hub.publish(conversationId, {
        type: SseType.TOOL_INVOCATION_START,
        chat_entry_id: toolEntryId,
        tool_name: task.toolName,
        approval_required: false,
        ...(argsPreview ? { args_preview: argsPreview } : {}),
      });
    }

    this.toolExecutionLogs.append({
      taskId: taskId ?? null,
      conversationId,
      toolName: task.toolName,
      phase: "started",
      payload: {
        params: task.params,
      },
    });

    const entries = this.chatEntries.listMessages(conversationId);
    const tool = this.tools.get(task.toolName);
    if (!tool) {
      const output = `Tool not found: ${task.toolName}`;
      const finishedAt = new Date();
      const envelope: ToolExecutionEnvelope = {
        ok: false,
        toolId: task.toolName,
        output: null,
        error: output,
        permission_state: "forbid",
        timing: {
          started_at: startedAt.toISOString(),
          finished_at: finishedAt.toISOString(),
          elapsed_ms: Math.max(0, finishedAt.getTime() - startedAtMs),
        },
      };
      this.hub.publish(conversationId, {
        type: SseType.TOOL_INVOCATION_END,
        tool_name: task.toolName,
        output,
        ok: false,
        run_continues: hasPendingBatchTools(),
      });
      if (!toolEntryId) {
        const created = this.chatEntries.appendToolInvocation(conversationId, {
          toolId: task.toolName,
          state: "error",
          parameters: task.toolRequest
            ? { tool_request: task.toolRequest, source: "planner_tool_request" }
            : task.params && typeof task.params === "object" && !Array.isArray(task.params)
              ? (task.params as Record<string, unknown>)
              : { raw: task.params },
          result: envelope,
        });
        toolEntryId = created.id;
      }
      this.chatEntries.updateToolInvocation(conversationId, {
        id: toolEntryId,
        state: "error",
        result: envelope,
      });
      this.toolExecutionLogs.append({
        taskId: taskId ?? null,
        conversationId,
        toolName: task.toolName,
        phase: "failed",
        payload: envelope,
      });
      throw new Error(output);
    }

    const defaultRulesRaw =
      tool.getDefaultRules() && typeof tool.getDefaultRules() === "object"
        ? (tool.getDefaultRules() as unknown as Record<string, unknown>)
        : {};
    const parsedRules = tool.parseRules(task.agentToolConfig?.rules ?? defaultRulesRaw);
    let resolvedParams: unknown;
    try {
      resolvedParams = task.toolRequest ? await this.resolveToolParamsFromPlannerRequest(task, tool, opts?.shouldCancel) : task.params;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const finishedAt = new Date();
      const envelope: ToolExecutionEnvelope = {
        ok: false,
        toolId: task.toolName,
        output: null,
        error: detail,
        permission_state: "forbid",
        timing: {
          started_at: startedAt.toISOString(),
          finished_at: finishedAt.toISOString(),
          elapsed_ms: Math.max(0, finishedAt.getTime() - startedAtMs),
        },
      };
      if (!toolEntryId) {
        const created = this.chatEntries.appendToolInvocation(conversationId, {
          toolId: task.toolName,
          state: "error",
          parameters: task.toolRequest
            ? { tool_request: task.toolRequest, source: "planner_tool_request" }
            : {},
          result: {
            ...envelope,
            stage: "tool_request_resolution",
          },
        });
        toolEntryId = created.id;
      }
      this.chatEntries.updateToolInvocation(conversationId, {
        id: toolEntryId,
        state: "error",
        result: {
          ...envelope,
          stage: "tool_request_resolution",
        },
      });
      this.hub.publish(conversationId, {
        type: SseType.TOOL_INVOCATION_END,
        tool_name: task.toolName,
        output: detail,
        ok: false,
        run_continues: hasPendingBatchTools(),
      });
      throw e;
    }
    const parsedParams = tool.parseParams(resolvedParams);
    throwIfCancelled(opts?.shouldCancel);

    const rules = await tool.evaluatePermission({
      conversationId,
      agentId: task.agentId,
      entries,
      agentToolConfig: {
        enabled: task.agentToolConfig?.enabled !== false,
        policy: task.agentToolConfig?.policy ?? "allow",
        rules: parsedRules,
      },
    });
    const effectivePermission = mostPermissivePermission(rules);

    this.toolExecutionLogs.append({
      taskId: taskId ?? null,
      conversationId,
      toolName: task.toolName,
      phase: "permission_evaluated",
      payload: {
        rules,
        outcome: effectivePermission,
      },
    });

    if (effectivePermission === "forbid" || (effectivePermission === "ask_user" && task.approvalGranted !== true)) {
      const outState = effectivePermission === "ask_user" ? "requested" : "error";
      const reason =
        effectivePermission === "ask_user" ? "Tool requires user approval." : "Tool is forbidden by permission rules.";
      const finishedAt = new Date();
      const envelope: ToolExecutionEnvelope = {
        ok: false,
        toolId: task.toolName,
        output: null,
        error: reason,
        permission_state: effectivePermission,
        timing: {
          started_at: startedAt.toISOString(),
          finished_at: finishedAt.toISOString(),
          elapsed_ms: Math.max(0, finishedAt.getTime() - startedAtMs),
        },
      };
      if (!toolEntryId) {
        const resolvedParamsRecord =
          parsedParams && typeof parsedParams === "object" && !Array.isArray(parsedParams)
            ? (parsedParams as Record<string, unknown>)
            : {};
        const created = this.chatEntries.appendToolInvocation(conversationId, {
          toolId: task.toolName,
          state: outState,
          parameters: task.toolRequest
            ? {
                ...resolvedParamsRecord,
                tool_request: task.toolRequest,
                source: "planner_tool_request",
              }
            : resolvedParamsRecord,
          result: envelope,
        });
        toolEntryId = created.id;
      }
      if (effectivePermission === "ask_user") {
        this.hub.publish(conversationId, {
          type: SseType.TOOL_INVOCATION_START,
          chat_entry_id: toolEntryId,
          tool_name: task.toolName,
          approval_required: true,
          ...(task.toolRequest ? { args_preview: task.toolRequest } : argsPreview ? { args_preview: argsPreview } : {}),
        });
      } else {
        this.hub.publish(conversationId, {
          type: SseType.TOOL_INVOCATION_END,
          tool_name: task.toolName,
          output: reason,
          ok: false,
        });
      }
      this.chatEntries.updateToolInvocation(conversationId, {
        id: toolEntryId,
        state: outState,
        result: envelope,
      });
      this.toolExecutionLogs.append({
        taskId: taskId ?? null,
        conversationId,
        toolName: task.toolName,
        phase: "blocked",
        payload: { ...envelope, rules },
      });
      return;
    }

    if (!toolEntryId) {
      const resolvedParamsRecord =
        parsedParams && typeof parsedParams === "object" && !Array.isArray(parsedParams)
          ? (parsedParams as Record<string, unknown>)
          : {};
      const created = this.chatEntries.appendToolInvocation(conversationId, {
        toolId: task.toolName,
        state: "running",
        parameters: task.toolRequest
          ? {
              ...resolvedParamsRecord,
              tool_request: task.toolRequest,
              source: "planner_tool_request",
            }
          : resolvedParamsRecord,
        result: null,
      });
      toolEntryId = created.id;
    }
    this.hub.publish(conversationId, {
      type: SseType.TOOL_INVOCATION_START,
      chat_entry_id: toolEntryId,
      tool_name: task.toolName,
      approval_required: false,
      ...(task.toolRequest ? { args_preview: task.toolRequest } : argsPreview ? { args_preview: argsPreview } : {}),
    });

    throwIfCancelled(opts?.shouldCancel);
    const outputValue = await tool.runTool(parsedParams, {
      conversationId,
      agentId: task.agentId,
      entries,
      toolRules: parsedRules,
    });
    throwIfCancelled(opts?.shouldCancel);
    const finishedAt = new Date();
    const envelope: ToolExecutionEnvelope = {
      ok: true,
      toolId: task.toolName,
      output: outputValue,
      error: null,
      permission_state: "allow",
      timing: {
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        elapsed_ms: Math.max(0, finishedAt.getTime() - startedAtMs),
      },
    };

    this.hub.publish(conversationId, {
      type: SseType.TOOL_INVOCATION_END,
      tool_name: task.toolName,
      output: safeStringify(outputValue),
      ok: true,
      run_continues: hasPendingBatchTools(),
    });
    this.chatEntries.updateToolInvocation(conversationId, {
      id: toolEntryId,
      state: "done",
      result: envelope,
    });
    this.toolExecutionLogs.append({
      taskId: taskId ?? null,
      conversationId,
      toolName: task.toolName,
      phase: "completed",
      payload: { ...envelope, rules },
    });
    if (!hasPendingBatchTools()) {
      this.enqueueContinueConversation(conversationId);
    }
    logger.info({ conversationId, toolName: task.toolName }, "[tool] run_tool completed");
  }

  private findPendingToolInvocationEntry(conversationId: string, task: RunToolTask): ToolInvocationEntry | null {
    const rows = this.chatEntries.listMessages(conversationId);
    const matches = rows
      .filter((row): row is ToolInvocationEntry => row.type === "tool-invocation")
      .filter((row) => row.toolId === task.toolName)
      .filter((row) => row.state === "requested" || row.state === "running");
    if (matches.length === 0) return null;
    if (task.toolRequest) {
      const withRequest = matches.filter((row) => {
        const toolRequest = String((row.parameters as Record<string, unknown>)?.tool_request ?? "").trim();
        return toolRequest === task.toolRequest;
      });
      return withRequest.at(-1) ?? matches.at(-1) ?? null;
    }
    return matches.at(-1) ?? null;
  }

  private async resolveToolParamsFromPlannerRequest(
    task: RunToolTask,
    tool: NonNullable<ReturnType<ToolRegistry["get"]>>,
    shouldCancel?: () => boolean
  ): Promise<Record<string, unknown>> {
    throwIfCancelled(shouldCancel);
    const plannerRequest = String(task.toolRequest ?? "").trim();
    if (!plannerRequest) {
      throw new Error(`run_tool task missing toolRequest for ${task.toolName}`);
    }
    const config = this.llmProviderSettings.getDocument().llm_configuration;
    const providerId = String(config.tool_call_provider_id || config.provider_id || "openai");
    const model = String(config.tool_call_model_name || config.model_name || "gpt-4o-mini");
    const provider = this.llmProviderSettings.getProvider(providerId);
    if (!provider) {
      throw new Error(`unknown provider for tool request resolution: ${providerId}`);
    }
    const providerSettings = this.llmProviderSettings.getProviderSettings(providerId);
    if (!providerSettings) {
      throw new Error(`provider settings not found for tool request resolution: ${providerId}`);
    }
    const toolParamPrompt = `You produce ONLY JSON object parameters for one tool.

Tool name: ${tool.getName()}
Tool AI description: ${tool.getAiDescription()}
Tool parameter JSON schema:
${JSON.stringify(tool.getParamsSchema(), null, 2)}

Tool request:
${plannerRequest}

Return ONLY valid JSON object for tool parameters.`;
    const resolverEntryId = crypto.randomUUID();
    const resolverCreatedAt = new Date().toISOString();
    const resolverStartedAtMs = Date.now();
    const resolverEntry = this.chatEntries.appendPlannerLlmStreamEntry(task.conversationId, {
      id: resolverEntryId,
      createdAt: resolverCreatedAt,
      llmRequest: toolParamPrompt,
      llmResponse: "",
      thoughtMs: null,
      decision: null,
      status: "running",
      llmModel: model,
    });
    this.hub.publish(task.conversationId, {
      type: SseType.PLANNER_STARTING,
      chat_entry_id: resolverEntryId,
      conversationIndex: resolverEntry.conversationIndex,
      createdAt: resolverEntry.createdAt,
      request_text: toolParamPrompt,
      llm_model: model,
    });

    let reconstructedReply = "";
    let resolverTokenUsage: { promptTokens: number; completionTokens: number; cachedPromptTokens?: number } | undefined;
    let completionText = "";
    try {
      const completion = await provider.streamTextCompletion(
        providerSettings,
        {
          model,
          prompt: toolParamPrompt,
          requestParams: {},
        },
        (delta) => {
          throwIfCancelled(shouldCancel);
          reconstructedReply += delta;
          this.hub.publish(task.conversationId, {
            type: SseType.PLANNER_LLM_STREAM,
            chat_entry_id: resolverEntryId,
            delta,
          });
        }
      );
      resolverTokenUsage = completion.usage;
      completionText = reconstructedReply || completion.text || "";
    } catch (e) {
      const partialUsage = usageFromStreamingError(e);
      if (partialUsage) {
        resolverTokenUsage = partialUsage;
      }
      const detail = e instanceof Error ? e.message : String(e);
      const cancelled = isTaskCancelledError(e);
      this.chatEntries.updatePlannerLlmStreamEntry(task.conversationId, {
        id: resolverEntryId,
        llmRequest: toolParamPrompt,
        llmResponse: composeFailedPlannerResponse(reconstructedReply),
        thoughtMs: Math.max(0, Date.now() - resolverStartedAtMs),
        decision: null,
        status: cancelled ? "cancelled" : "failed",
        error: detail,
        llmModel: model,
        ...(resolverTokenUsage !== undefined
          ? {
              promptTokens: resolverTokenUsage.promptTokens,
              ...(resolverTokenUsage.cachedPromptTokens !== undefined
                ? { cachedPromptTokens: resolverTokenUsage.cachedPromptTokens }
                : {}),
              completionTokens: resolverTokenUsage.completionTokens,
            }
          : {}),
      });
      this.hub.publish(task.conversationId, {
        type: SseType.PLANNER_RESPONSE,
        chat_entry_id: resolverEntryId,
        summary: cancelled ? "Cancelled" : detail,
        finished: true,
        action: cancelled ? "cancelled" : "failed",
        llm_model: model,
        ...(resolverTokenUsage !== undefined
          ? {
              prompt_tokens: resolverTokenUsage.promptTokens,
              ...(resolverTokenUsage.cachedPromptTokens !== undefined
                ? { cached_prompt_tokens: resolverTokenUsage.cachedPromptTokens }
                : {}),
              completion_tokens: resolverTokenUsage.completionTokens,
            }
          : {}),
      });
      throw e;
    }
    const parsed = parseJsonObjectFromCompletionText({
      text: completionText,
      context: `tool resolver response for ${task.toolName}`,
    });
    this.chatEntries.updatePlannerLlmStreamEntry(task.conversationId, {
      id: resolverEntryId,
      llmRequest: toolParamPrompt,
      llmResponse: completionText,
      thoughtMs: Math.max(0, Date.now() - resolverStartedAtMs),
      decision: {
        type: "tool-invocation",
        toolId: task.toolName,
        parameters: {},
      },
      status: "completed",
      llmModel: model,
      ...(resolverTokenUsage !== undefined
        ? {
            promptTokens: resolverTokenUsage.promptTokens,
            ...(resolverTokenUsage.cachedPromptTokens !== undefined
              ? { cachedPromptTokens: resolverTokenUsage.cachedPromptTokens }
              : {}),
            completionTokens: resolverTokenUsage.completionTokens,
          }
        : {}),
    });
    this.hub.publish(task.conversationId, {
      type: SseType.PLANNER_RESPONSE,
      chat_entry_id: resolverEntryId,
      summary: `Resolved parameters for ${task.toolName}`,
      finished: true,
      action: "tool_call",
      tool_name: task.toolName,
      llm_model: model,
      ...(resolverTokenUsage !== undefined
        ? {
            prompt_tokens: resolverTokenUsage.promptTokens,
            ...(resolverTokenUsage.cachedPromptTokens !== undefined
              ? { cached_prompt_tokens: resolverTokenUsage.cachedPromptTokens }
              : {}),
            completion_tokens: resolverTokenUsage.completionTokens,
          }
        : {}),
    });
    return parsed;
  }
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
