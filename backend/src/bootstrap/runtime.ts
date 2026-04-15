import type { PostConversationMessageRequest } from "../routes/conversations.types.js";
import { AgentTaskType } from "../domain/agentTask.js";
import { ContinueConversationTaskProcessor } from "../domain/continueConversationTaskProcessor.js";
import { RunToolTaskProcessor } from "../domain/runToolTaskProcessor.js";
import { ConversationEventHub } from "../events/conversationEventHub.js";
import { InMemoryJobQueue } from "../infra/inMemoryJobQueue.js";
import { logger } from "../infra/logger.js";
import { AgentsRepo } from "../infra/repositories/agentsRepo.js";
import { ChatEntriesRepo } from "../infra/repositories/chatEntriesRepo.js";
import { ConversationsRepo } from "../infra/repositories/conversationsRepo.js";
import { LlmProviderSettingsRepo } from "../infra/repositories/llmProviderSettingsRepo.js";
import { ModelCapabilitiesRepo } from "../infra/repositories/modelCapabilitiesRepo.js";
import { ModelPresetsRepo } from "../infra/repositories/modelPresetsRepo.js";
import { TasksRepo } from "../infra/repositories/tasksRepo.js";
import { ToolExecutionLogsRepo } from "../infra/repositories/toolExecutionLogsRepo.js";
import { UploadsRepo } from "../infra/repositories/uploadsRepo.js";
import { ToolRegistry } from "../tools/toolRegistry.js";
import { GetCurrentTimeTool } from "../tools/builtins/getCurrentTime/tool.js";
import { CurlTool } from "../tools/builtins/curl/tool.js";
import type { UserMessageEntry } from "../types/chatEntry.js";
import { SseType } from "../types/sse.js";
import { maybeAutoTitleConversation } from "./runtime/autoTitle.js";
import { createTaskEnqueueHelpers, registerTaskQueueHandler } from "./runtime/taskQueue.js";

export type EnqueueUserMessageResult =
  | { kind: "ok"; taskId: number }
  | { kind: "conversation_not_found" }
  | { kind: "agent_not_found" }
  | { kind: "invalid_message" }
  | { kind: "invalid_attachment"; attachmentId: string };

export type ApproveToolInvocationResult =
  | { kind: "ok"; taskId: number }
  | { kind: "conversation_not_found" }
  | { kind: "tool_invocation_not_found" }
  | { kind: "tool_invocation_not_requested" };

export type CancelConversationProcessingResult =
  | { kind: "ok"; cancelledTaskCount: number }
  | { kind: "conversation_not_found" };

export type Runtime = ReturnType<typeof createRuntime>;

export function createRuntime(opts: {
  agents: AgentsRepo;
  conversations: ConversationsRepo;
  chatEntries: ChatEntriesRepo;
  llmProviderSettings: LlmProviderSettingsRepo;
  modelPresets: ModelPresetsRepo;
  modelCapabilities: ModelCapabilitiesRepo;
  tasks: TasksRepo;
  uploads: UploadsRepo;
  toolExecutionLogs: ToolExecutionLogsRepo;
}) {
  const {
    agents,
    conversations,
    chatEntries,
    llmProviderSettings,
    modelPresets,
    modelCapabilities,
    tasks,
    uploads,
    toolExecutionLogs,
  } = opts;
  const hub = new ConversationEventHub();
  const queue = new InMemoryJobQueue();
  const tools = new ToolRegistry();
  tools.register(new GetCurrentTimeTool());
  tools.register(new CurlTool());
  const { enqueueContinueConversation, enqueueRunTool } = createTaskEnqueueHelpers({
    tasks,
    queue,
  });

  const continueConversationTaskProcessor = new ContinueConversationTaskProcessor(
    chatEntries,
    conversations,
    hub,
    llmProviderSettings,
    modelPresets,
    agents,
    uploads,
    tools,
    enqueueRunTool,
  );
  const runToolTaskProcessor = new RunToolTaskProcessor(
    chatEntries,
    hub,
    tools,
    toolExecutionLogs,
    enqueueContinueConversation,
  );
  registerTaskQueueHandler({
    queue,
    tasks,
    continueConversationTaskProcessor,
    runToolTaskProcessor,
  });

  function enqueueUserMessage(conversationId: string, body: PostConversationMessageRequest): EnqueueUserMessageResult {
    const entriesBefore = chatEntries.countEntries(conversationId);
    const text = String(body.message ?? "").trim();
    const attachmentIds = Array.isArray(body.attachment_ids)
      ? body.attachment_ids.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    const attachments = attachmentIds
      .map((id) => ({ id, attachment: uploads.getById(id) }))
      .map((row) => {
        if (!row.attachment) return row;
        return row;
      });
    const missing = attachments.find((row) => !row.attachment);
    if (missing) {
      return { kind: "invalid_attachment", attachmentId: missing.id };
    }
    const resolvedAttachments = attachments.map((row) => row.attachment).filter((x): x is NonNullable<typeof x> => !!x);
    if (!text && resolvedAttachments.length === 0) {
      logger.warn({ conversationId }, "[chat] rejected empty user message");
      return { kind: "invalid_message" };
    }
    if (!conversations.exists(conversationId)) {
      logger.warn({ conversationId }, "[chat] rejected user message: conversation not found");
      return { kind: "conversation_not_found" };
    }
    const agentId = String(body.agent_id ?? "").trim();
    if (!agentId || !agents.get(agentId)) {
      logger.warn({ conversationId, agentId: agentId || null }, "[chat] rejected user message: agent not found");
      return { kind: "agent_not_found" };
    }

    logger.info(
      {
        conversationId,
        agentId,
        messageChars: text.length,
        llmProviderId: body.llm_provider_id ?? null,
        llmModel: body.llm_model ?? null,
        modelPresetId: body.model_preset_id ?? null,
        attachmentCount: resolvedAttachments.length,
      },
      "[chat] enqueue user message",
    );
    const user = chatEntries.appendUserMessage(conversationId, text, {
      agentId,
      llmProviderId: body.llm_provider_id,
      llmModel: body.llm_model,
      modelPresetId: body.model_preset_id ?? null,
      attachments: resolvedAttachments,
    });
    const userEntry: UserMessageEntry = {
      id: user.id,
      conversationIndex: user.conversationIndex,
      createdAt: user.createdAt,
      type: "user-message",
      text: user.text,
      agentId: user.agentId,
      ...(user.llmProviderId ? { llmProviderId: user.llmProviderId } : {}),
      ...(user.llmModel ? { llmModel: user.llmModel } : {}),
      ...(user.modelPresetId != null ? { modelPresetId: user.modelPresetId } : {}),
      ...(user.attachments?.length ? { attachments: user.attachments } : {}),
    };
    hub.publish(conversationId, {
      type: SseType.USER_MESSAGE,
      entry: userEntry,
    });

    const task = tasks.create({
      task_type: AgentTaskType.CONTINUE_CONVERSATION,
      payload: { conversationId },
    });
    logger.info({ conversationId, taskId: task.id }, "[chat] continue_conversation task created");
    queue.enqueue({ taskId: task.id });
    logger.info({ conversationId, taskId: task.id }, "[chat] continue_conversation task enqueued");
    if (entriesBefore === 0) {
      void maybeAutoTitleConversation({
        conversations,
        chatEntries,
        llmProviderSettings,
        hub,
        conversationId,
        firstMessage: text,
      });
    }
    return { kind: "ok", taskId: task.id };
  }

  function approveToolInvocation(conversationId: string, toolInvocationId: string): ApproveToolInvocationResult {
    if (!conversations.exists(conversationId)) return { kind: "conversation_not_found" };
    const entries = chatEntries.listMessages(conversationId);
    const row = entries.find((entry) => entry.type === "tool-invocation" && entry.id === toolInvocationId);
    if (!row || row.type !== "tool-invocation") {
      return { kind: "tool_invocation_not_found" };
    }
    if (row.state !== "requested") {
      return { kind: "tool_invocation_not_requested" };
    }

    const lastUser = [...entries].reverse().find((entry): entry is UserMessageEntry => entry.type === "user-message");
    const agentId = lastUser?.agentId ?? null;
    const agent = agentId ? agents.get(agentId) : null;
    const rules = agent?.default_llm_configuration?.tools?.[row.toolId]?.rules ?? {};

    const { taskId } = enqueueRunTool({
      conversationId,
      agentId,
      toolName: row.toolId,
      params: row.parameters ?? {},
      toolInvocationEntryId: row.id,
      approvalGranted: true,
      agentToolConfig: {
        enabled: true,
        policy: "allow",
        rules,
      },
    });
    return { kind: "ok", taskId };
  }

  function cancelConversationProcessing(conversationId: string): CancelConversationProcessingResult {
    if (!conversations.exists(conversationId)) {
      return { kind: "conversation_not_found" };
    }
    const cancelledTaskCount = tasks.cancelOpenByConversationId(conversationId);
    logger.info({ conversationId, cancelledTaskCount }, "[chat] cancel conversation processing requested");
    return { kind: "ok", cancelledTaskCount };
  }

  return {
    agents,
    conversations,
    chatEntries,
    llmProviderSettings,
    modelPresets,
    modelCapabilities,
    tasks,
    uploads,
    hub,
    queue,
    tools,
    continueConversationTaskProcessor,
    enqueueUserMessage,
    approveToolInvocation,
    cancelConversationProcessing,
    enqueueRunTool,
  };
}
