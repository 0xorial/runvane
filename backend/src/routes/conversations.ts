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

  function conversationCostsUsdById(): Map<string, number> {
    const usageRows = runtime.chatEntries.listConversationTokenUsageByModel();
    const capabilities = runtime.modelCapabilities.listEffective();
    const pricingByModel = new Map<string, { inCost: number; outCost: number }>();
    for (const cap of capabilities) {
      const model = String(cap.model_name || "").trim();
      if (!model || pricingByModel.has(model)) continue;
      const inCost =
        typeof cap.usd_per_1m_tokens_in === "number" &&
        Number.isFinite(cap.usd_per_1m_tokens_in)
          ? cap.usd_per_1m_tokens_in
          : typeof cap.input_cost_per_1m === "number" &&
              Number.isFinite(cap.input_cost_per_1m)
            ? cap.input_cost_per_1m
            : null;
      const outCost =
        typeof cap.usd_per_1m_tokens_out === "number" &&
        Number.isFinite(cap.usd_per_1m_tokens_out)
          ? cap.usd_per_1m_tokens_out
          : typeof cap.output_cost_per_1m === "number" &&
              Number.isFinite(cap.output_cost_per_1m)
            ? cap.output_cost_per_1m
            : null;
      if (inCost == null || outCost == null) continue;
      pricingByModel.set(model, { inCost, outCost });
    }

    const out = new Map<string, number>();
    for (const row of usageRows) {
      const prices = pricingByModel.get(row.model_name);
      if (!prices) continue;
      const estimate =
        (row.prompt_tokens / 1_000_000) * prices.inCost +
        (row.completion_tokens / 1_000_000) * prices.outCost;
      out.set(row.conversation_id, (out.get(row.conversation_id) ?? 0) + estimate);
    }
    return out;
  }

  r.get("/", (c) => {
    const rows = runtime.conversations.list();
    const costsById = conversationCostsUsdById();
    return c.json(
      rows.map((row) => ({
        ...row,
        estimated_cost_usd: Number((costsById.get(row.id) ?? 0).toFixed(8)),
      })),
    );
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
