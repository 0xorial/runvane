import type { ChatEntriesRepo } from "../infra/repositories/chatEntriesRepo.js";
import type { ToolExecutionLogsRepo } from "../infra/repositories/toolExecutionLogsRepo.js";
import { logger } from "../infra/logger.js";
import { SseType } from "../types/sse.js";
import type { RunToolTask } from "./agentTask.js";
import type { ConversationEventHub } from "../events/conversationEventHub.js";
import {
  mostPermissivePermission,
} from "../tools/baseTool.js";
import type { ToolRegistry } from "../tools/toolRegistry.js";

export class RunToolTaskProcessor {
  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: ConversationEventHub,
    private readonly tools: ToolRegistry,
    private readonly toolExecutionLogs: ToolExecutionLogsRepo,
    private readonly enqueueContinueConversation: (conversationId: string) => { taskId: number },
  ) {}

  async process(task: RunToolTask, taskId?: number): Promise<void> {
    const conversationId = task.conversationId;
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
      this.hub.publish(conversationId, {
        type: SseType.TOOL_INVOCATION_END,
        tool_name: task.toolName,
        output,
        ok: false,
      });
      this.chatEntries.updateToolInvocation(conversationId, {
        id: toolEntryId ?? toolEntry?.id ?? "",
        state: "error",
        result: output,
      });
      this.toolExecutionLogs.append({
        taskId: taskId ?? null,
        conversationId,
        toolName: task.toolName,
        phase: "failed",
        payload: { reason: output },
      });
      throw new Error(output);
    }

    const defaultRulesRaw =
      tool.getDefaultRules() && typeof tool.getDefaultRules() === "object"
        ? (tool.getDefaultRules() as unknown as Record<string, unknown>)
        : {};
    const parsedRules = tool.parseRules(task.agentToolConfig?.rules ?? defaultRulesRaw);
    const parsedParams = tool.parseParams(task.params);

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

    if (
      effectivePermission === "forbid" ||
      (effectivePermission === "ask_user" && task.approvalGranted !== true)
    ) {
      const outState = effectivePermission === "ask_user" ? "requested" : "error";
      const reason =
        effectivePermission === "ask_user"
          ? "Tool requires user approval."
          : "Tool is forbidden by permission rules.";
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
        result: reason,
      });
      this.toolExecutionLogs.append({
        taskId: taskId ?? null,
        conversationId,
        toolName: task.toolName,
        phase: "blocked",
        payload: {
          reason,
          rules,
          kind: effectivePermission,
        },
      });
      return;
    }

    const outputValue = await tool.runTool(parsedParams, {
      conversationId,
      agentId: task.agentId,
      entries,
      toolRules: parsedRules,
    });

    this.hub.publish(conversationId, {
      type: SseType.TOOL_INVOCATION_END,
      tool_name: task.toolName,
      output: safeStringify(outputValue),
      ok: true,
    });
    this.chatEntries.updateToolInvocation(conversationId, {
      id: toolEntryId ?? toolEntry?.id ?? "",
      state: "done",
      result: outputValue,
    });
    this.toolExecutionLogs.append({
      taskId: taskId ?? null,
      conversationId,
      toolName: task.toolName,
      phase: "completed",
      payload: { output: outputValue, rules },
    });
    this.enqueueContinueConversation(conversationId);
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
