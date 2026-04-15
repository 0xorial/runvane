import type { ChatEntriesRepo } from "../infra/repositories/chatEntriesRepo.js";
import type { ToolExecutionLogsRepo } from "../infra/repositories/toolExecutionLogsRepo.js";
import { logger } from "../infra/logger.js";
import { SseType } from "../types/sse.js";
import type { RunToolTask } from "./agentTask.js";
import type { ConversationEventHub } from "../events/conversationEventHub.js";
import { mostPermissivePermission } from "../tools/baseTool.js";
import type { ToolRegistry } from "../tools/toolRegistry.js";
import { throwIfCancelled } from "./taskCancellation.js";

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
    private readonly enqueueContinueConversation: (conversationId: string) => { taskId: number },
  ) {}

  async process(task: RunToolTask, taskId?: number, opts?: { shouldCancel?: () => boolean }): Promise<void> {
    const conversationId = task.conversationId;
    throwIfCancelled(opts?.shouldCancel);
    const startedAt = new Date();
    const startedAtMs = startedAt.getTime();
    const argsPreview = safeStringify(task.params);
    const toolEntryId = task.toolInvocationEntryId;
    const toolEntry = toolEntryId
      ? null
      : this.chatEntries.appendToolInvocation(conversationId, {
          toolId: task.toolName,
          state: "running",
          parameters:
            task.params && typeof task.params === "object" && !Array.isArray(task.params)
              ? (task.params as Record<string, unknown>)
              : { raw: task.params },
          result: null,
        });

    if (!toolEntryId) {
      this.hub.publish(conversationId, {
        type: SseType.TOOL_INVOCATION_START,
        chat_entry_id: toolEntry?.id ?? "",
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
        run_continues: task.resumeAfterTool === false,
      });
      this.chatEntries.updateToolInvocation(conversationId, {
        id: toolEntryId ?? toolEntry?.id ?? "",
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
      if (effectivePermission === "ask_user") {
        this.hub.publish(conversationId, {
          type: SseType.TOOL_INVOCATION_START,
          chat_entry_id: toolEntryId ?? toolEntry?.id ?? "",
          tool_name: task.toolName,
          approval_required: true,
          ...(argsPreview ? { args_preview: argsPreview } : {}),
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
        id: toolEntryId ?? toolEntry?.id ?? "",
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
      run_continues: task.resumeAfterTool === false,
    });
    this.chatEntries.updateToolInvocation(conversationId, {
      id: toolEntryId ?? toolEntry?.id ?? "",
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
    if (task.resumeAfterTool !== false) {
      this.enqueueContinueConversation(conversationId);
    }
    logger.info({ conversationId, toolName: task.toolName }, "[tool] run_tool completed");
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
