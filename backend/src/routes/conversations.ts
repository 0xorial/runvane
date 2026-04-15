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
      model_name: string;
      prompt_tokens: number;
      cached_prompt_tokens: number;
      completion_tokens: number;
    }>,
  ) {
    return {
      ...row,
      is_deleted: Number(row.is_deleted ?? 0) === 1,
      token_usage_by_model: usageByModel,
    };
  }

  function conversationUsageById(): Map<
    string,
    Array<{
      model_name: string;
      prompt_tokens: number;
      cached_prompt_tokens: number;
      completion_tokens: number;
    }>
  > {
    return usageByConversationId(runtime.chatEntries.listConversationTokenUsageByModel());
  }

  r.get("/", (c) => {
    const deletedMode = c.req.query("deleted") === "only";
    const rows = runtime.conversations.list({ deletedOnly: deletedMode });
    const groups = runtime.conversations.listGroups();
    const usageById = conversationUsageById();
    return c.json(
      {
        conversations: rows.map((row) => toApiConversationRow(row, usageById.get(row.id) ?? [])),
        groups,
      },
    );
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
    const hasGroupIdUpdate = Object.prototype.hasOwnProperty.call(update, "group_id");
    const hasNewGroupNameUpdate = Object.prototype.hasOwnProperty.call(update, "new_group_name");
    if (!hasTitleUpdate && !hasGroupIdUpdate && !hasNewGroupNameUpdate) {
      return c.json({ detail: "title or group update is required" }, 400);
    }
    if (hasGroupIdUpdate && hasNewGroupNameUpdate) {
      return c.json({ detail: "provide either group_id or new_group_name, not both" }, 400);
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
        groupUpdated = runtime.conversations.updateGroupId(conversationId, update.group_id ?? null);
      } catch (e) {
        const detail = e instanceof Error ? e.message : "invalid group_id";
        return c.json({ detail }, 400);
      }
      if (!groupUpdated) return c.json({ detail: "conversation not found or deleted" }, 404);
      updated = groupUpdated;
    }

    if (hasNewGroupNameUpdate) {
      const groupUpdated = runtime.conversations.updateGroupName(
        conversationId,
        String(update.new_group_name || ""),
      );
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
    return c.json({ conversation_id: conversationId, deleted: true });
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
    return c.json({ conversation_id: conversationId, task_id: result.taskId }, 202);
  });

  r.post("/:conversationId/cancel-processing", (c) => {
    const conversationId = c.req.param("conversationId");
    const result = runtime.cancelConversationProcessing(conversationId);
    if (result.kind === "conversation_not_found") {
      return c.json({ detail: "conversation not found" }, 404);
    }
    return c.json({
      conversation_id: conversationId,
      cancelled_tasks: result.cancelledTaskCount,
    });
  });

  return r;
}
