import type { PostConversationMessageRequest } from "../routes/conversations.types.js";
import type { RunToolTask } from "../domain/agentTask.js";
import {
  configureThoughtRuntime,
  configureThoughtTypeProviders,
  initiateThought,
  initiateThoughtWithSeed,
} from "../domain/thoughtProcessing/index.js";
import { reprocessPlannerPrepareStep } from "../domain/thoughtProcessing/steps/prepareStep.js";
import { reprocessPlannerReasonStep } from "../domain/thoughtProcessing/steps/reasonStep.js";
import { RunToolTaskProcessor } from "../domain/runToolTaskProcessor.js";
import type {
  ToolParamsPrepareSeed,
  ToolParamsThought,
} from "../domain/thoughtProcessing/thoughtTypeProviders/toolParamsProvider.js";
import { ConversationEventHub } from "../events/conversationEventHub.js";
import { logger } from "../infra/logger.js";
import { AgentsRepo } from "../infra/repositories/agentsRepo.js";
import { ChatEntriesRepo } from "../infra/repositories/chatEntriesRepo.js";
import { ConversationsRepo } from "../infra/repositories/conversationsRepo.js";
import { LlmProviderSettingsRepo } from "../infra/repositories/llmProviderSettingsRepo.js";
import { ModelCapabilitiesRepo } from "../infra/repositories/modelCapabilitiesRepo.js";
import { ModelPresetsRepo } from "../infra/repositories/modelPresetsRepo.js";
import { ToolExecutionLogsRepo } from "../infra/repositories/toolExecutionLogsRepo.js";
import { UploadsRepo } from "../infra/repositories/uploadsRepo.js";
import { ToolRegistry } from "../tools/toolRegistry.js";
import { GetCurrentTimeTool } from "../tools/builtins/getCurrentTime/tool.js";
import { CurlTool } from "../tools/builtins/curl/tool.js";
import type { UserMessageEntry } from "../types/chatEntry.js";
import { SseType } from "../types/sse.js";

export type EnqueueUserMessageResult =
  | { kind: "ok" }
  | { kind: "conversation_not_found" }
  | { kind: "agent_not_found" }
  | { kind: "invalid_message" }
  | { kind: "invalid_attachment"; attachmentId: string };

export type ApproveToolInvocationResult =
  | { kind: "ok" }
  | { kind: "conversation_not_found" }
  | { kind: "tool_invocation_not_found" }
  | { kind: "tool_invocation_not_requested" };

export type CancelConversationProcessingResult =
  | { kind: "ok"; cancelledTaskCount: number }
  | { kind: "conversation_not_found" };

export type ReprocessThoughtResult =
  | { kind: "ok"; plannerEntryId: string; queuedToolCalls: number }
  | { kind: "conversation_not_found" };

export type Runtime = ReturnType<typeof createRuntime>;

export function createRuntime(opts: {
  agents: AgentsRepo;
  conversations: ConversationsRepo;
  chatEntries: ChatEntriesRepo;
  llmProviderSettings: LlmProviderSettingsRepo;
  modelPresets: ModelPresetsRepo;
  modelCapabilities: ModelCapabilitiesRepo;
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
    uploads,
    toolExecutionLogs,
  } = opts;
  const hub = new ConversationEventHub();
  const activeExecutions = new Map<string, AbortController>();
  const activeTitleExecutions = new Map<string, AbortController>();
  const tools = new ToolRegistry();
  tools.register(new GetCurrentTimeTool());
  tools.register(new CurlTool());
  const beginExecution = (conversationId: string): AbortController => {
    activeExecutions.get(conversationId)?.abort();
    const controller = new AbortController();
    activeExecutions.set(conversationId, controller);
    return controller;
  };
  const finishExecution = (conversationId: string, controller: AbortController): void => {
    if (activeExecutions.get(conversationId) === controller) {
      activeExecutions.delete(conversationId);
    }
  };
  const beginTitleExecution = (conversationId: string): AbortController => {
    activeTitleExecutions.get(conversationId)?.abort();
    const controller = new AbortController();
    activeTitleExecutions.set(conversationId, controller);
    return controller;
  };
  const finishTitleExecution = (conversationId: string, controller: AbortController): void => {
    if (activeTitleExecutions.get(conversationId) === controller) {
      activeTitleExecutions.delete(conversationId);
    }
  };

  const runToolTaskProcessor = new RunToolTaskProcessor(chatEntries, hub, tools, toolExecutionLogs);

  configureThoughtRuntime({
    chatEntries,
    llmProviderSettings,
    hub,
    agents,
    tools,
  });
  configureThoughtTypeProviders({
    autoTitle: {
      conversations,
      chatEntries,
      hub,
    },
    planner: {
      chatEntries,
      hub,
      executeToolRequest: async (input) => {
        const tool = tools.get(input.toolName);
        if (!tool) {
          throw new Error(`tool request references missing tool: ${input.toolName}`);
        }
        if (!input.agentId) {
          throw new Error("planner tool execution requires agentId");
        }
        await initiateThoughtWithSeed<ToolParamsPrepareSeed, ToolParamsThought>({
          thoughtType: "toolParams",
          thought: {
            thoughtId: crypto.randomUUID(),
            conversationId: input.conversationId,
            streamEntryId: "",
          },
          seed: {
            conversationId: input.conversationId,
            sourceEntryId: input.continuationAnchorId,
            agentId: input.agentId,
            toolName: input.toolName,
            toolAiDescription: tool.getAiDescription(),
            toolParamsSchema: tool.getParamsSchema(),
            toolRequest: input.toolRequest,
            agentToolConfig: agents.get(input.agentId)?.default_llm_configuration?.tools?.[input.toolName],
            plannerFollowup: {
              mode: input.followup,
              userText: input.userText,
              enabledToolIds: input.enabledToolIds,
            },
          },
        });
      },
    },
    toolParams: {
      chatEntries,
      hub,
      runToolTaskProcessor,
    },
  });

  const startReactiveConversationProcessing = (conversationId: string, sourceEntryId?: string): void => {
    const controller = beginExecution(conversationId);
    void (async () => {
      const sourceOnActiveLineage =
        sourceEntryId == null || chatEntries.isEntryOnActiveLineage(conversationId, sourceEntryId);
      if (sourceEntryId && !sourceOnActiveLineage) {
        logger.info(
          { conversationId, sourceEntryId },
          "[task] source entry not on active lineage; falling back to active leaf"
        );
      }
      await initiateThought(
        {
          conversationId,
          thoughtType: "planner",
        },
        { signal: controller.signal }
      );
    })()
      .catch((error) => {
        logger.error(
          {
            conversationId,
            sourceEntryId: sourceEntryId ?? null,
            detail: error instanceof Error ? error.message : String(error),
            error,
          },
          "[chat] reactive conversation processing failed"
        );
      })
      .finally(() => {
        finishExecution(conversationId, controller);
      });
  };

  function enqueueUserMessage(conversationId: string, body: PostConversationMessageRequest): EnqueueUserMessageResult {
    const entriesBefore = chatEntries.countEntries(conversationId);
    const text = String(body.message ?? "").trim();
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.map((x) => String(x || "").trim()).filter(Boolean)
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
    const agentId = String(body.agentId ?? "").trim();
    if (!agentId || !agents.get(agentId)) {
      logger.warn({ conversationId, agentId: agentId || null }, "[chat] rejected user message: agent not found");
      return { kind: "agent_not_found" };
    }

    logger.info(
      {
        conversationId,
        agentId,
        messageChars: text.length,
        llmProviderId: body.llmProviderId ?? null,
        llmModel: body.llmModel ?? null,
        modelPresetId: body.modelPresetId ?? null,
        attachmentCount: resolvedAttachments.length,
      },
      "[chat] enqueue user message"
    );
    const user = chatEntries.appendUserMessage(conversationId, text, {
      agentId,
      llmProviderId: body.llmProviderId,
      llmModel: body.llmModel,
      modelPresetId: body.modelPresetId ?? null,
      attachments: resolvedAttachments,
    });
    const userEntry: UserMessageEntry = {
      id: user.id,
      conversationIndex: user.conversationIndex,
      createdAt: user.createdAt,
      parentId: user.parentId,
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

    if (entriesBefore === 0) {
      let plannerSourceEntryId = user.id;
      const titleController = beginTitleExecution(conversationId);
      void initiateThought(
        {
          conversationId,
          thoughtType: "autoTitle",
        },
        {
          signal: titleController.signal,
          onStarted: ({ thoughtActionEntryId }) => {
            if (thoughtActionEntryId) plannerSourceEntryId = thoughtActionEntryId;
          },
        }
      )
        .catch((error) => {
          logger.error(
            {
              conversationId,
              detail: error instanceof Error ? error.message : String(error),
              error,
            },
            "[chat] auto title failed"
          );
        })
        .finally(() => {
          finishTitleExecution(conversationId, titleController);
        });
      startReactiveConversationProcessing(conversationId, plannerSourceEntryId);
    } else {
      startReactiveConversationProcessing(conversationId, user.id);
    }
    return { kind: "ok" };
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

    const toolRequest = String((row.parameters as Record<string, unknown>)?.tool_request ?? "").trim();
    const storedParams = Object.fromEntries(
      Object.entries(row.parameters).filter(
        ([key]) =>
          ![
            "tool_request",
            "source",
            "planner_followup_mode",
            "planner_followup_user_text",
            "planner_followup_enabled_tool_ids",
          ].includes(key)
      )
    );
    const plannerFollowupMode = String((row.parameters as Record<string, unknown>)?.planner_followup_mode ?? "").trim();
    const plannerFollowupUserText = String(
      (row.parameters as Record<string, unknown>)?.planner_followup_user_text ?? ""
    ).trim();
    const plannerFollowupEnabledToolIdsRaw = (row.parameters as Record<string, unknown>)
      ?.planner_followup_enabled_tool_ids;
    const plannerFollowupEnabledToolIds = Array.isArray(plannerFollowupEnabledToolIdsRaw)
      ? plannerFollowupEnabledToolIdsRaw.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const controller = beginExecution(conversationId);
    const runToolTask: RunToolTask = {
      conversationId,
      sourceEntryId: row.id,
      agentId,
      toolName: row.toolId,
      params: storedParams,
      ...(toolRequest ? { toolRequest } : {}),
      ...(plannerFollowupMode === "continue" && plannerFollowupUserText && plannerFollowupEnabledToolIds.length > 0
        ? {
            plannerFollowup: {
              mode: "continue",
              userText: plannerFollowupUserText,
              enabledToolIds: plannerFollowupEnabledToolIds,
            } as const,
          }
        : {}),
      approvalGranted: true,
      agentToolConfig: {
        enabled: true,
        policy: "allow",
        rules,
      },
    };
    void runToolTaskProcessor
      .allowAndRun(runToolTask, { signal: controller.signal })
      .then((result) => {
        if (result.kind !== "completed") return;
        startReactiveConversationProcessing(conversationId, result.toolEntryId);
      })
      .catch((error) => {
        logger.error(
          {
            conversationId,
            toolInvocationId,
            detail: error instanceof Error ? error.message : String(error),
            error,
          },
          "[chat] approved tool execution failed"
        );
      })
      .finally(() => {
        finishExecution(conversationId, controller);
      });
    return { kind: "ok" };
  }

  function cancelConversationProcessing(conversationId: string): CancelConversationProcessingResult {
    if (!conversations.exists(conversationId)) {
      return { kind: "conversation_not_found" };
    }
    const controller = activeExecutions.get(conversationId);
    const titleController = activeTitleExecutions.get(conversationId);
    const cancelledTaskCount = (controller ? 1 : 0) + (titleController ? 1 : 0);
    controller?.abort();
    titleController?.abort();
    logger.info({ conversationId, cancelledTaskCount }, "[chat] cancel conversation processing requested");
    return { kind: "ok", cancelledTaskCount };
  }

  async function reprocessThoughtReason(
    conversationId: string,
    input: {
      sourceEntryId: string;
      editedResponse: string;
    }
  ): Promise<ReprocessThoughtResult> {
    if (!conversations.exists(conversationId)) {
      return { kind: "conversation_not_found" };
    }
    const out = await reprocessPlannerReasonStep({
      conversationId,
      sourceEntryId: input.sourceEntryId,
      editedResponse: input.editedResponse,
    });
    return {
      kind: "ok",
      plannerEntryId: out.plannerEntryId,
      queuedToolCalls: out.queuedToolCalls,
    };
  }

  async function reprocessThoughtContext(
    conversationId: string,
    input: {
      sourceEntryId: string;
      editedRequestText: string;
      llmProviderId: string;
      llmModel: string;
    }
  ): Promise<ReprocessThoughtResult> {
    if (!conversations.exists(conversationId)) {
      return { kind: "conversation_not_found" };
    }
    const out = await reprocessPlannerPrepareStep({
      conversationId,
      sourceEntryId: input.sourceEntryId,
      editedRequestText: input.editedRequestText,
      llmProviderId: input.llmProviderId,
      llmModel: input.llmModel,
    });
    return {
      kind: "ok",
      plannerEntryId: out.plannerEntryId,
      queuedToolCalls: out.queuedToolCalls,
    };
  }

  return {
    agents,
    conversations,
    chatEntries,
    llmProviderSettings,
    modelPresets,
    modelCapabilities,
    uploads,
    hub,
    tools,
    enqueueUserMessage,
    approveToolInvocation,
    cancelConversationProcessing,
    reprocessThoughtReason,
    reprocessThoughtContext,
    startReactiveConversationProcessing,
    activeExecutionCount: () => activeExecutions.size + activeTitleExecutions.size,
  };
}
