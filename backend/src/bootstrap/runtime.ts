import type { PostConversationMessageRequest } from "../routes/conversations.types.js";
import { AgentTaskType, type AgentTask } from "../domain/agentTask.js";
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
import { TasksRepo, type TaskRow } from "../infra/repositories/tasksRepo.js";
import { ToolExecutionLogsRepo } from "../infra/repositories/toolExecutionLogsRepo.js";
import { UploadsRepo } from "../infra/repositories/uploadsRepo.js";
import { ToolRegistry } from "../tools/toolRegistry.js";
import { GetCurrentTimeTool } from "../tools/builtins/getCurrentTime/tool.js";
import { CurlTool } from "../tools/builtins/curl/tool.js";
import type { UserMessageEntry } from "../types/chatEntry.js";
import { SseType } from "../types/sse.js";

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

export type RenameConversationResult =
  | { kind: "ok"; conversation: ReturnType<ConversationsRepo["create"]> }
  | { kind: "conversation_not_found" }
  | { kind: "invalid_title" };

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

  function fallbackConversationTitle(firstMessage: string): string {
    const text = String(firstMessage || "").replace(/\s+/g, " ").trim();
    if (!text) return "New chat";
    return text.length > 64 ? `${text.slice(0, 64).trim()}...` : text;
  }

  async function generateConversationTitleUsingSystemModel(
    firstMessage: string,
  ): Promise<string | null> {
    const doc = llmProviderSettings.getDocument();
    const providerId = String(doc.llm_configuration.provider_id || "").trim();
    const model = String(doc.llm_configuration.model_name || "").trim();
    if (!providerId || !model) return null;
    const provider = llmProviderSettings.getProvider(providerId);
    const providerSettings = llmProviderSettings.getProviderSettings(providerId);
    if (!provider || !providerSettings) return null;
    const prompt =
      "Generate a short conversation title (3-6 words max). " +
      "Return plain text only, no quotes, no punctuation at the end.\n\n" +
      `First message: ${firstMessage}`;
    try {
      const { text: out } = await provider.streamTextCompletion(
        providerSettings,
        { model, prompt },
        () => {},
      );
      const clean = String(out || "")
        .replace(/\s+/g, " ")
        .replace(/^["'`]+|["'`]+$/g, "")
        .trim();
      if (!clean) return null;
      return clean.length > 80 ? clean.slice(0, 80).trim() : clean;
    } catch {
      return null;
    }
  }

  function maybeAutoTitleConversation(conversationId: string, firstMessage: string): void {
    const row = conversations.get(conversationId);
    if (!row) return;
    if (String(row.title || "").trim() !== "New chat") return;
    void (async () => {
      const byModel = await generateConversationTitleUsingSystemModel(firstMessage);
      const title = byModel || fallbackConversationTitle(firstMessage);
      const current = conversations.get(conversationId);
      if (!current || String(current.title || "").trim() !== "New chat") return;
      const updated = conversations.updateTitle(conversationId, title);
      if (!updated) return;
      hub.publish(conversationId, {
        type: SseType.CONVERSATION_UPDATED,
        conversation: updated,
      });
    })();
  }
  function enqueueContinueConversation(conversationId: string): { taskId: number } {
    const task = tasks.create({
      task_type: AgentTaskType.CONTINUE_CONVERSATION,
      payload: { conversationId },
    });
    queue.enqueue({ taskId: task.id });
    return { taskId: task.id };
  }

  function enqueueRunTool(input: {
    conversationId: string;
    agentId: string | null;
    toolName: string;
    params: unknown;
    toolInvocationEntryId?: string;
    approvalGranted?: boolean;
    agentToolConfig?: {
      enabled?: boolean;
      policy?: "allow" | "ask_user" | "forbid";
      rules?: Record<string, unknown>;
    };
  }): { taskId: number } {
    const task = tasks.create({
      task_type: AgentTaskType.RUN_TOOL,
      payload: {
        conversationId: input.conversationId,
        agentId: input.agentId,
        toolName: input.toolName,
        params: input.params,
        toolInvocationEntryId: input.toolInvocationEntryId ?? null,
        approvalGranted: input.approvalGranted === true,
        agentToolConfig: input.agentToolConfig ?? null,
      },
    });
    queue.enqueue({ taskId: task.id });
    return { taskId: task.id };
  }

  const continueConversationTaskProcessor = new ContinueConversationTaskProcessor(
    chatEntries,
    hub,
    llmProviderSettings,
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

  function enqueueUserMessage(
    conversationId: string,
    body: PostConversationMessageRequest,
  ): EnqueueUserMessageResult {
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
    const resolvedAttachments = attachments
      .map((row) => row.attachment)
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (!text && resolvedAttachments.length === 0) {
      logger.warn({ conversationId }, "[chat] rejected empty user message");
      return { kind: "invalid_message" };
    }
    if (!conversations.exists(conversationId)) {
      logger.warn(
        { conversationId },
        "[chat] rejected user message: conversation not found",
      );
      return { kind: "conversation_not_found" };
    }
    const agentId = String(body.agent_id ?? "").trim();
    if (!agentId || !agents.get(agentId)) {
      logger.warn(
        { conversationId, agentId: agentId || null },
        "[chat] rejected user message: agent not found",
      );
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
      ...(user.agentId ? { agentId: user.agentId } : {}),
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
    logger.info(
      { conversationId, taskId: task.id },
      "[chat] continue_conversation task created",
    );
    queue.enqueue({ taskId: task.id });
    logger.info(
      { conversationId, taskId: task.id },
      "[chat] continue_conversation task enqueued",
    );
    if (entriesBefore === 0) {
      maybeAutoTitleConversation(conversationId, text);
    }
    return { kind: "ok", taskId: task.id };
  }

  function renameConversation(
    conversationId: string,
    title: string,
  ): RenameConversationResult {
    if (!conversations.exists(conversationId)) return { kind: "conversation_not_found" };
    const next = String(title || "").trim();
    if (!next) return { kind: "invalid_title" };
    const updated = conversations.updateTitle(conversationId, next);
    if (!updated) return { kind: "conversation_not_found" };
    hub.publish(conversationId, {
      type: SseType.CONVERSATION_UPDATED,
      conversation: updated,
    });
    return { kind: "ok", conversation: updated };
  }

  function approveToolInvocation(
    conversationId: string,
    toolInvocationId: string,
  ): ApproveToolInvocationResult {
    if (!conversations.exists(conversationId)) return { kind: "conversation_not_found" };
    const entries = chatEntries.listMessages(conversationId);
    const row = entries.find(
      (entry) => entry.type === "tool-invocation" && entry.id === toolInvocationId,
    );
    if (!row || row.type !== "tool-invocation") {
      return { kind: "tool_invocation_not_found" };
    }
    if (row.state !== "requested") {
      return { kind: "tool_invocation_not_requested" };
    }

    const lastUser = [...entries]
      .reverse()
      .find((entry): entry is UserMessageEntry => entry.type === "user-message");
    const agentId = lastUser?.agentId ?? null;
    const agent = agentId ? agents.get(agentId) : null;
    const cfg = agent?.default_llm_configuration ?? {};
    const toolsCfg =
      cfg.tools && typeof cfg.tools === "object" && !Array.isArray(cfg.tools)
        ? (cfg.tools as Record<string, unknown>)
        : {};
    const toolCfgRaw = toolsCfg[row.toolId];
    const toolCfg =
      toolCfgRaw && typeof toolCfgRaw === "object" && !Array.isArray(toolCfgRaw)
        ? (toolCfgRaw as Record<string, unknown>)
        : {};
    const rulesRaw = toolCfg.rules;
    const rules =
      rulesRaw && typeof rulesRaw === "object" && !Array.isArray(rulesRaw)
        ? (rulesRaw as Record<string, unknown>)
        : {};

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
    renameConversation,
    enqueueRunTool,
  };
}
