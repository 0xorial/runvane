import type { ChatEntriesRepo } from "../infra/repositories/chatEntriesRepo.js";
import type { ToolExecutionLogsRepo } from "../infra/repositories/toolExecutionLogsRepo.js";
import { logger } from "../infra/logger.js";
import { SseType } from "../types/sse.js";
import type { ToolInvocationEntry } from "../types/chatEntry.js";
import type { RunToolTask } from "./agentTask.js";
import type { ConversationEventHub } from "../events/conversationEventHub.js";
import { mostPermissivePermission } from "../tools/baseTool.js";
import type { ToolRegistry } from "../tools/toolRegistry.js";
import { throwIfCancelled } from "./taskCancellation.js";
import { initiateThought } from "./thoughtProcessing/index.js";
import type { PlannerPrepareSeed, PlannerThought } from "./thoughtProcessing/thoughtTypeProviders/plannerProvider.js";

type ToolExecutionEnvelope = {
  ok: boolean;
  toolId: string;
  output: unknown;
  error: string | null;
  permission_state: "allow" | "ask_user" | "forbid";
  timing: { started_at: string; finished_at: string; elapsed_ms: number };
};

export type RunToolExecutionResult =
  | {
      kind: "skipped";
    }
  | {
      kind: "completed";
      toolEntryId: string;
    }
  | {
      kind: "blocked";
      toolEntryId: string;
    };

export class RunToolTaskProcessor {
  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: ConversationEventHub,
    private readonly tools: ToolRegistry,
    private readonly toolExecutionLogs: ToolExecutionLogsRepo,
  ) {}

  async process(task: RunToolTask, opts?: { shouldCancel?: () => boolean }): Promise<RunToolExecutionResult> {
    const conversationId = task.conversationId;
    if (task.sourceEntryId && !this.chatEntries.isEntryOnActiveLineage(conversationId, task.sourceEntryId)) {
      logger.info(
        {
          conversationId,
          sourceEntryId: task.sourceEntryId,
          toolName: task.toolName,
        },
        "[tool] skipped run_tool: source entry not on active lineage",
      );
      return { kind: "skipped" };
    }
    throwIfCancelled(opts?.shouldCancel);
    const startedAt = new Date();
    const startedAtMs = startedAt.getTime();
    const argsPreview = safeStringify(task.params);
    const existingEntry = this.findPendingToolInvocationEntry(conversationId, task);
    let toolEntryId = existingEntry?.id ?? "";
    let toolEntryParentId = existingEntry?.parentId ?? null;
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
      toolEntryParentId = created.parentId;
      this.hub.publish(conversationId, {
        type: SseType.TOOL_INVOCATION_START,
        chatEntryId: toolEntryId,
        toolName: task.toolName,
        approvalRequired: false,
        ...(toolEntryParentId ? { parentId: toolEntryParentId } : {}),
        ...(argsPreview ? { argsPreview: argsPreview } : {}),
      });
    }

    this.toolExecutionLogs.append({
      taskId: null,
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
        toolName: task.toolName,
        output,
        ok: false,
        runContinues: false,
      });
      if (!toolEntryId) {
        const created = this.chatEntries.appendToolInvocation(conversationId, {
          toolId: task.toolName,
          state: "error",
          parameters: task.toolRequest
            ? { tool_request: task.toolRequest, source: "planner_tool_request", ...plannerFollowupMetadata(task) }
            : task.params && typeof task.params === "object" && !Array.isArray(task.params)
              ? (task.params as Record<string, unknown>)
              : { raw: task.params },
          result: envelope,
        });
        toolEntryId = created.id;
        toolEntryParentId = created.parentId;
      }
      this.chatEntries.updateToolInvocation(conversationId, {
        id: toolEntryId,
        state: "error",
        result: envelope,
      });
      this.toolExecutionLogs.append({
        taskId: null,
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
    const parsedParams = tool.parseParams(task.params);
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
      taskId: null,
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
                ...plannerFollowupMetadata(task),
              }
            : resolvedParamsRecord,
          result: envelope,
        });
        toolEntryId = created.id;
        toolEntryParentId = created.parentId;
      }
      if (effectivePermission === "ask_user") {
        this.hub.publish(conversationId, {
          type: SseType.TOOL_INVOCATION_START,
          chatEntryId: toolEntryId,
          toolName: task.toolName,
          approvalRequired: true,
          ...(toolEntryParentId ? { parentId: toolEntryParentId } : {}),
          ...(task.toolRequest ? { argsPreview: task.toolRequest } : argsPreview ? { argsPreview: argsPreview } : {}),
        });
      } else {
        this.hub.publish(conversationId, {
          type: SseType.TOOL_INVOCATION_END,
          toolName: task.toolName,
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
        taskId: null,
        conversationId,
        toolName: task.toolName,
        phase: "blocked",
        payload: { ...envelope, rules },
      });
      return { kind: "blocked", toolEntryId };
    }

    return this.runTool({
      task,
      startedAt,
      startedAtMs,
      argsPreview,
      toolEntryId,
      toolEntryParentId,
      entries,
      tool,
      parsedParams,
      parsedRules,
      rules,
      shouldCancel: opts?.shouldCancel,
    });
  }

  async allowAndRun(task: RunToolTask, opts?: { shouldCancel?: () => boolean }): Promise<RunToolExecutionResult> {
    const pending = this.findPendingToolInvocationEntry(task.conversationId, task);
    if (!pending || pending.state !== "requested") {
      logger.info(
        {
          conversationId: task.conversationId,
          sourceEntryId: task.sourceEntryId ?? null,
          toolName: task.toolName,
        },
        "[tool] skipped allowAndRun: no requested invocation",
      );
      return { kind: "skipped" };
    }
    return this.process(
      {
        ...task,
        sourceEntryId: pending.id,
        approvalGranted: true,
      },
      opts,
    );
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

  private async runTool(input: {
    task: RunToolTask;
    startedAt: Date;
    startedAtMs: number;
    argsPreview: string;
    toolEntryId: string;
    toolEntryParentId: string | null;
    entries: ReturnType<ChatEntriesRepo["listMessages"]>;
    tool: NonNullable<ReturnType<ToolRegistry["get"]>>;
    parsedParams: unknown;
    parsedRules: Record<string, unknown>;
    rules: Awaited<ReturnType<NonNullable<ReturnType<ToolRegistry["get"]>>["evaluatePermission"]>>;
    shouldCancel?: () => boolean;
  }): Promise<RunToolExecutionResult> {
    const { task, startedAt, startedAtMs, argsPreview, entries, tool, parsedParams, parsedRules, rules } = input;
    const conversationId = task.conversationId;
    let toolEntryId = input.toolEntryId;
    let toolEntryParentId = input.toolEntryParentId;
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
              ...plannerFollowupMetadata(task),
            }
          : resolvedParamsRecord,
        result: null,
      });
      toolEntryId = created.id;
      toolEntryParentId = created.parentId;
    }
    this.hub.publish(conversationId, {
      type: SseType.TOOL_INVOCATION_START,
      chatEntryId: toolEntryId,
      toolName: task.toolName,
      approvalRequired: false,
      ...(toolEntryParentId ? { parentId: toolEntryParentId } : {}),
      ...(task.toolRequest ? { argsPreview: task.toolRequest } : argsPreview ? { argsPreview: argsPreview } : {}),
    });
    throwIfCancelled(input.shouldCancel);
    const outputValue = await tool.runTool(parsedParams, {
      conversationId,
      agentId: task.agentId,
      entries,
      toolRules: parsedRules,
    });
    throwIfCancelled(input.shouldCancel);
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
      toolName: task.toolName,
      output: safeStringify(outputValue),
      ok: true,
      runContinues: false,
    });
    this.chatEntries.updateToolInvocation(conversationId, {
      id: toolEntryId,
      state: "done",
      result: envelope,
    });
    this.toolExecutionLogs.append({
      taskId: null,
      conversationId,
      toolName: task.toolName,
      phase: "completed",
      payload: { ...envelope, rules },
    });
    logger.info({ conversationId, toolName: task.toolName }, "[tool] run_tool completed");
    if (task.plannerFollowup?.mode === "continue") {
      throwIfCancelled(input.shouldCancel);
      await initiateThought<PlannerPrepareSeed, PlannerThought>(
        {
          thoughtType: "planner",
          thought: {
            thoughtId: crypto.randomUUID(),
            conversationId,
            streamEntryId: "",
          },
          seed: {
            conversationId,
            anchorEntryId: toolEntryId,
            userText: task.plannerFollowup.userText,
            enabledToolIds: task.plannerFollowup.enabledToolIds,
          },
        },
        {
          shouldCancel: input.shouldCancel,
        },
      );
    }
    return { kind: "completed", toolEntryId };
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

function plannerFollowupMetadata(task: RunToolTask): Record<string, unknown> {
  if (!task.plannerFollowup) return {};
  return {
    planner_followup_mode: task.plannerFollowup.mode,
    planner_followup_user_text: task.plannerFollowup.userText,
    planner_followup_enabled_tool_ids: task.plannerFollowup.enabledToolIds,
  };
}
