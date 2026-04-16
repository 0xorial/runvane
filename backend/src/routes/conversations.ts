import { Hono } from "hono";

import type { Runtime } from "../bootstrap/runtime.js";
import { logger } from "../infra/logger.js";
import { SseType } from "../types/sse.js";
import { parseJsonObjectOr400 } from "../http/parseJsonObjectOr400.js";
import { usageByConversationId } from "../domain/conversationUsage.js";
import {
  parseCreateConversationTitle,
  parseUpdateConversationRequest,
  toPostConversationMessageAcceptedResponse,
  validatePostConversationMessageRequest,
} from "./conversations.types.js";

export function createConversationsRouter(runtime: Runtime) {
  const r = new Hono();

  function toApiConversationRow(
    row: ReturnType<Runtime["conversations"]["get"]> extends infer T ? Exclude<T, null> : never,
    usageByModel: Array<{
      modelName: string;
      promptTokens: number;
      cachedPromptTokens: number;
      completionTokens: number;
    }>,
  ) {
    return {
      id: row.id,
      title: row.title,
      groupId: row.group_id,
      isDeleted: Number(row.is_deleted ?? 0) === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      promptTokensTotal: row.prompt_tokens_total,
      cachedPromptTokensTotal: row.cached_prompt_tokens_total,
      completionTokensTotal: row.completion_tokens_total,
      tokenUsageByModel: usageByModel,
    };
  }

  function conversationUsageById(): Map<
    string,
    Array<{
      modelName: string;
      promptTokens: number;
      cachedPromptTokens: number;
      completionTokens: number;
    }>
  > {
    return usageByConversationId(runtime.chatEntries.listConversationTokenUsageByModel());
  }

  r.get("/", (c) => {
    const deletedMode = c.req.query("deleted") === "only";
    const rows = runtime.conversations.list({ deletedOnly: deletedMode });
    const groups = runtime.conversations.listGroups().map((group) => ({
      id: group.id,
      name: group.name,
      createdAt: group.created_at,
      updatedAt: group.updated_at,
    }));
    const usageById = conversationUsageById();
    return c.json({
      conversations: rows.map((row) => toApiConversationRow(row, usageById.get(row.id) ?? [])),
      groups,
    });
  });

  r.post("/", async (c) => {
    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;

    const title = parseCreateConversationTitle(parsed.value);
    const created = runtime.conversations.create(title);
    runtime.hub.publish(created.id, {
      type: SseType.CONVERSATION_CREATED,
      conversation: toApiConversationRow(created, []),
    });
    return c.json(toApiConversationRow(created, []));
  });

  r.put("/:conversationId", async (c) => {
    const conversationId = c.req.param("conversationId");
    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;
    const update = parseUpdateConversationRequest(parsed.value);
    if (!runtime.conversations.exists(conversationId)) {
      return c.json({ detail: "conversation not found" }, 404);
    }
    const hasTitleUpdate = Object.prototype.hasOwnProperty.call(update, "title");
    const hasGroupIdUpdate = Object.prototype.hasOwnProperty.call(update, "groupId");
    const hasNewGroupNameUpdate = Object.prototype.hasOwnProperty.call(update, "newGroupName");
    if (!hasTitleUpdate && !hasGroupIdUpdate && !hasNewGroupNameUpdate) {
      return c.json({ detail: "title or group update is required" }, 400);
    }
    if (hasGroupIdUpdate && hasNewGroupNameUpdate) {
      return c.json({ detail: "provide either groupId or newGroupName, not both" }, 400);
    }

    let updated = runtime.conversations.get(conversationId, { includeDeleted: true });
    if (!updated) return c.json({ detail: "conversation not found" }, 404);

    if (hasTitleUpdate) {
      const nextTitle = String(update.title || "").trim();
      if (!nextTitle) {
        return c.json({ detail: "title is required when provided" }, 400);
      }
      const titleUpdated = runtime.conversations.updateTitle(conversationId, nextTitle);
      if (!titleUpdated) return c.json({ detail: "conversation not found or deleted" }, 404);
      updated = titleUpdated;
    }

    if (hasGroupIdUpdate) {
      let groupUpdated;
      try {
        groupUpdated = runtime.conversations.updateGroupId(conversationId, update.groupId ?? null);
      } catch (e) {
        const detail = e instanceof Error ? e.message : "invalid groupId";
        return c.json({ detail }, 400);
      }
      if (!groupUpdated) return c.json({ detail: "conversation not found or deleted" }, 404);
      updated = groupUpdated;
    }

    if (hasNewGroupNameUpdate) {
      const groupUpdated = runtime.conversations.updateGroupName(conversationId, String(update.newGroupName || ""));
      if (!groupUpdated) return c.json({ detail: "conversation not found or deleted" }, 404);
      updated = groupUpdated;
    }
    const usageById = conversationUsageById();
    runtime.hub.publish(conversationId, {
      type: SseType.CONVERSATION_UPDATED,
      conversation: toApiConversationRow(updated, usageById.get(conversationId) ?? []),
    });
    return c.json(toApiConversationRow(updated, usageById.get(conversationId) ?? []));
  });

  r.delete("/:conversationId", (c) => {
    const conversationId = c.req.param("conversationId");
    const deleted = runtime.conversations.softDelete(conversationId);
    if (!deleted) return c.json({ detail: "conversation not found or already deleted" }, 404);
    const usageById = conversationUsageById();
    runtime.hub.publish(conversationId, {
      type: SseType.CONVERSATION_UPDATED,
      conversation: toApiConversationRow(deleted, usageById.get(conversationId) ?? []),
    });
    return c.json(toApiConversationRow(deleted, usageById.get(conversationId) ?? []));
  });

  r.post("/:conversationId/undelete", (c) => {
    const conversationId = c.req.param("conversationId");
    const restored = runtime.conversations.undelete(conversationId);
    if (!restored) return c.json({ detail: "conversation not found or not deleted" }, 404);
    const usageById = conversationUsageById();
    runtime.hub.publish(conversationId, {
      type: SseType.CONVERSATION_UPDATED,
      conversation: toApiConversationRow(restored, usageById.get(conversationId) ?? []),
    });
    return c.json(toApiConversationRow(restored, usageById.get(conversationId) ?? []));
  });

  r.delete("/:conversationId/permanent", (c) => {
    const conversationId = c.req.param("conversationId");
    const removed = runtime.conversations.hardDelete(conversationId);
    if (!removed) return c.json({ detail: "conversation not found or not deleted" }, 404);
    return c.json({ conversationId, deleted: true });
  });

  r.get("/:conversationId/messages", (c) => {
    const conversationId = c.req.param("conversationId");
    if (!runtime.conversations.exists(conversationId)) {
      return c.json({ detail: "conversation not found" }, 404);
    }
    return c.json(runtime.chatEntries.listMessages(conversationId));
  });

  r.post("/:conversationId/messages", async (c) => {
    const conversationId = c.req.param("conversationId");
    logger.info({ conversationId }, "[http] post conversation message");
    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;

    let body;
    try {
      body = validatePostConversationMessageRequest(parsed.value);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "invalid request body";
      return c.json({ detail }, 400);
    }
    const result = runtime.enqueueUserMessage(conversationId, body);
    if (result.kind === "conversation_not_found") {
      return c.json({ detail: "conversation not found" }, 404);
    }
    if (result.kind === "agent_not_found") {
      return c.json({ detail: "agent not found" }, 400);
    }
    if (result.kind === "invalid_message") {
      return c.json({ detail: "message or attachment is required" }, 400);
    }
    if (result.kind === "invalid_attachment") {
      return c.json({ detail: `invalid attachment id: ${result.attachmentId}` }, 400);
    }

    const out = toPostConversationMessageAcceptedResponse(conversationId);
    logger.info({ conversationId, taskId: result.taskId }, "[http] message accepted");
    return c.json(out, 202);
  });

  r.post("/:conversationId/tool-invocations/:entryId/approve", (c) => {
    const conversationId = c.req.param("conversationId");
    const entryId = c.req.param("entryId");
    const result = runtime.approveToolInvocation(conversationId, entryId);
    if (result.kind === "conversation_not_found") {
      return c.json({ detail: "conversation not found" }, 404);
    }
    if (result.kind === "tool_invocation_not_found") {
      return c.json({ detail: "tool invocation not found" }, 404);
    }
    if (result.kind === "tool_invocation_not_requested") {
      return c.json({ detail: "tool invocation is not in requested state" }, 400);
    }
    return c.json({ conversationId, taskId: result.taskId }, 202);
  });

  r.post("/:conversationId/cancel-processing", (c) => {
    const conversationId = c.req.param("conversationId");
    const result = runtime.cancelConversationProcessing(conversationId);
    if (result.kind === "conversation_not_found") {
      return c.json({ detail: "conversation not found" }, 404);
    }
    return c.json({
      conversationId,
      cancelledTasks: result.cancelledTaskCount,
    });
  });

  return r;
}
