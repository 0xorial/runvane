import { Hono } from "hono";

import type { Runtime } from "../bootstrap/runtime.js";
import { logger } from "../infra/logger.js";
import { SseType } from "../types/sse.js";
import { parseJsonObjectOr400 } from "../http/parseJsonObjectOr400.js";
import {
  parseCreateConversationTitle,
  parseRenameConversationTitle,
  toPostConversationMessageAcceptedResponse,
  validatePostConversationMessageRequest,
} from "./conversations.types.js";

export function createConversationsRouter(runtime: Runtime) {
  const r = new Hono();

  r.get("/", (c) => {
    return c.json(runtime.conversations.list());
  });

  r.post("/", async (c) => {
    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;

    const title = parseCreateConversationTitle(parsed.value);
    const created = runtime.conversations.create(title);
    runtime.hub.publish(created.id, {
      type: SseType.CONVERSATION_CREATED,
      conversation: created,
    });
    return c.json(created);
  });

  r.put("/:conversationId", async (c) => {
    const conversationId = c.req.param("conversationId");
    const parsed = await parseJsonObjectOr400(c);
    if (!parsed.ok) return parsed.response;
    const title = parseRenameConversationTitle(parsed.value);
    if (!runtime.conversations.exists(conversationId)) {
      return c.json({ detail: "conversation not found" }, 404);
    }
    const next = String(title || "").trim();
    if (!next) {
      return c.json({ detail: "title is required" }, 400);
    }
    const updated = runtime.conversations.updateTitle(conversationId, next);
    if (!updated) {
      return c.json({ detail: "conversation not found" }, 404);
    }
    runtime.hub.publish(conversationId, {
      type: SseType.CONVERSATION_UPDATED,
      conversation: updated,
    });
    return c.json(updated);
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

  return r;
}
