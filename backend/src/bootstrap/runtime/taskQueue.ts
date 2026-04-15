import { AgentTaskType, type AgentTask } from "../../domain/agentTask.js";
import { ContinueConversationTaskProcessor } from "../../domain/continueConversationTaskProcessor.js";
import { RunToolTaskProcessor } from "../../domain/runToolTaskProcessor.js";
import { InMemoryJobQueue } from "../../infra/inMemoryJobQueue.js";
import { logger } from "../../infra/logger.js";
import { TasksRepo, type TaskRow } from "../../infra/repositories/tasksRepo.js";

export type EnqueueRunToolInput = {
  conversationId: string;
  agentId: string | null;
  toolName: string;
  params: unknown;
  batchId?: string;
  resumeAfterTool?: boolean;
  toolInvocationEntryId?: string;
  approvalGranted?: boolean;
  agentToolConfig?: {
    enabled?: boolean;
    policy?: "allow" | "ask_user" | "forbid";
    rules?: Record<string, unknown>;
  };
};

function taskFromRow(row: TaskRow): AgentTask {
  if (row.task_type === AgentTaskType.CONTINUE_CONVERSATION) {
    const conversationId = String(row.payload.conversationId ?? "").trim();
    if (!conversationId) {
      throw new Error("continue_conversation task missing payload.conversationId");
    }
    return {
      type: AgentTaskType.CONTINUE_CONVERSATION,
      conversationId,
    };
  }
  if (row.task_type === AgentTaskType.RUN_TOOL) {
    const conversationId = String(row.payload.conversationId ?? "").trim();
    const toolName = String(row.payload.toolName ?? "").trim();
    if (!conversationId) throw new Error("run_tool task missing payload.conversationId");
    if (!toolName) throw new Error("run_tool task missing payload.toolName");
    const agentIdRaw = row.payload.agentId;
    const agentId =
      typeof agentIdRaw === "string" && agentIdRaw.trim().length > 0
        ? agentIdRaw.trim()
        : null;
    return {
      type: AgentTaskType.RUN_TOOL,
      conversationId,
      agentId,
      toolName,
      params: row.payload.params,
      batchId:
        typeof row.payload.batchId === "string" && row.payload.batchId.trim().length > 0
          ? row.payload.batchId.trim()
          : undefined,
      resumeAfterTool: row.payload.resumeAfterTool !== false,
      toolInvocationEntryId:
        typeof row.payload.toolInvocationEntryId === "string" &&
        row.payload.toolInvocationEntryId.trim().length > 0
          ? row.payload.toolInvocationEntryId.trim()
          : undefined,
      approvalGranted: row.payload.approvalGranted === true,
      agentToolConfig:
        row.payload.agentToolConfig &&
        typeof row.payload.agentToolConfig === "object" &&
        !Array.isArray(row.payload.agentToolConfig)
          ? {
              enabled:
                (row.payload.agentToolConfig as Record<string, unknown>).enabled === undefined
                  ? undefined
                  : (row.payload.agentToolConfig as Record<string, unknown>).enabled === true,
              policy:
                (() => {
                  const raw = String(
                    (row.payload.agentToolConfig as Record<string, unknown>).policy ?? "",
                  );
                  return raw === "allow" || raw === "ask_user" || raw === "forbid"
                    ? raw
                    : undefined;
                })(),
              rules:
                (() => {
                  const raw = (row.payload.agentToolConfig as Record<string, unknown>).rules;
                  return raw && typeof raw === "object" && !Array.isArray(raw)
                    ? (raw as Record<string, unknown>)
                    : undefined;
                })(),
            }
          : undefined,
    };
  }
  throw new Error(`unsupported task_type: ${row.task_type}`);
}

export function createTaskEnqueueHelpers(opts: {
  tasks: TasksRepo;
  queue: InMemoryJobQueue;
}): {
  enqueueContinueConversation: (conversationId: string) => { taskId: number };
  enqueueRunTool: (input: EnqueueRunToolInput) => { taskId: number };
} {
  const { tasks, queue } = opts;
  function enqueueContinueConversation(conversationId: string): { taskId: number } {
    const task = tasks.create({
      task_type: AgentTaskType.CONTINUE_CONVERSATION,
      payload: { conversationId },
    });
    queue.enqueue({ taskId: task.id });
    return { taskId: task.id };
  }

  function enqueueRunTool(input: EnqueueRunToolInput): { taskId: number } {
    const task = tasks.create({
      task_type: AgentTaskType.RUN_TOOL,
      payload: {
        conversationId: input.conversationId,
        agentId: input.agentId,
        toolName: input.toolName,
        params: input.params,
        batchId: input.batchId ?? null,
        resumeAfterTool: input.resumeAfterTool !== false,
        toolInvocationEntryId: input.toolInvocationEntryId ?? null,
        approvalGranted: input.approvalGranted === true,
        agentToolConfig: input.agentToolConfig ?? null,
      },
    });
    queue.enqueue({ taskId: task.id });
    return { taskId: task.id };
  }
  return { enqueueContinueConversation, enqueueRunTool };
}

export function registerTaskQueueHandler(opts: {
  queue: InMemoryJobQueue;
  tasks: TasksRepo;
  continueConversationTaskProcessor: ContinueConversationTaskProcessor;
  runToolTaskProcessor: RunToolTaskProcessor;
}): void {
  const { queue, tasks, continueConversationTaskProcessor, runToolTaskProcessor } = opts;
  queue.setHandler(async (task) => {
    logger.info({ taskId: task.taskId }, "[queue] task dequeued");
    const row = tasks.getById(task.taskId);
    if (!row) {
      logger.warn({ taskId: task.taskId }, "[queue] task not found");
      return;
    }
    if (row.is_done) {
      logger.debug({ taskId: row.id }, "[queue] task already done");
      return;
    }
    if (!tasks.markStarted(row.id)) {
      logger.debug({ taskId: row.id }, "[queue] task start skipped");
      return;
    }
    logger.info(
      { taskId: row.id, taskType: row.task_type },
      "[queue] task marked started",
    );

    try {
      const parsed = taskFromRow(row);
      if (parsed.type === AgentTaskType.CONTINUE_CONVERSATION) {
        logger.info(
          { taskId: row.id, conversationId: parsed.conversationId },
          "[queue] processing continue_conversation",
        );
        await continueConversationTaskProcessor.process(parsed);
      } else if (parsed.type === AgentTaskType.RUN_TOOL) {
        logger.info(
          { taskId: row.id, conversationId: parsed.conversationId, toolName: parsed.toolName },
          "[queue] processing run_tool",
        );
        await runToolTaskProcessor.process(parsed, row.id);
      }
      tasks.markDone(row.id);
      logger.info({ taskId: row.id }, "[queue] task marked done");
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      tasks.markFailed(row.id, detail);
      logger.error({ taskId: row.id, detail, error: e }, "[queue] task failed");
      throw e;
    }
  });
}
