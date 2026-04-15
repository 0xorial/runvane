import { Hono } from "hono";

import type { Runtime } from "../bootstrap/runtime.js";
import { logger } from "../infra/logger.js";
import { SseType } from "../types/sse.js";
import { parseJsonObjectOr400 } from "../http/parseJsonObjectOr400.js";
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
    estimatedCostUsd: number,
  ) {
    return {
      ...row,
      is_deleted: Number(row.is_deleted ?? 0) === 1,
      estimated_cost_usd: Number(estimatedCostUsd.toFixed(8)),
    };
  }

  function conversationCostsUsdById(): Map<string, number> {
    const usageRows = runtime.chatEntries.listConversationTokenUsageByModel();
    const capabilities = runtime.modelCapabilities.listEffective();
    const pricingByModel = new Map<
      string,
      { inCost: number; cachedInCost: number; outCost: number }
    >();
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
      const cachedInCost =
        typeof cap.usd_per_1m_tokens_in_cached === "number" &&
        Number.isFinite(cap.usd_per_1m_tokens_in_cached)
          ? cap.usd_per_1m_tokens_in_cached
          : typeof cap.cached_input_cost_per_1m === "number" &&
              Number.isFinite(cap.cached_input_cost_per_1m)
            ? cap.cached_input_cost_per_1m
            : inCost;
      if (inCost == null || outCost == null || cachedInCost == null) continue;
      pricingByModel.set(model, { inCost, cachedInCost, outCost });
    }

    const out = new Map<string, number>();
    for (const row of usageRows) {
      const prices = pricingByModel.get(row.model_name);
      if (!prices) continue;
      const boundedPromptTokens = Math.max(0, row.prompt_tokens);
      const boundedCachedTokens = Math.max(
        0,
        Math.min(row.cached_prompt_tokens, boundedPromptTokens),
      );
      const nonCachedPromptTokens = Math.max(
        0,
        boundedPromptTokens - boundedCachedTokens,
      );
      const estimate =
        (nonCachedPromptTokens / 1_000_000) * prices.inCost +
        (boundedCachedTokens / 1_000_000) * prices.cachedInCost +
        (row.completion_tokens / 1_000_000) * prices.outCost;
      out.set(row.conversation_id, (out.get(row.conversation_id) ?? 0) + estimate);
    }
    return out;
  }

  r.get("/", (c) => {
    const deletedMode = c.req.query("deleted") === "only";
    const rows = runtime.conversations.list({ deletedOnly: deletedMode });
    const groups = runtime.conversations.listGroups();
    const costsById = conversationCostsUsdById();
    return c.json(
      {
        conversations: rows.map((row) => toApiConversationRow(row, costsById.get(row.id) ?? 0)),
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
      conversation: toApiConversationRow(created, 0),
    });
    return c.json(toApiConversationRow(created, 0));
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
    runtime.hub.publish(conversationId, {
      type: SseType.CONVERSATION_UPDATED,
      conversation: toApiConversationRow(updated, conversationCostsUsdById().get(conversationId) ?? 0),
    });
    return c.json(
      toApiConversationRow(updated, conversationCostsUsdById().get(conversationId) ?? 0),
    );
  });

  r.delete("/:conversationId", (c) => {
    const conversationId = c.req.param("conversationId");
    const deleted = runtime.conversations.softDelete(conversationId);
    if (!deleted) return c.json({ detail: "conversation not found or already deleted" }, 404);
    runtime.hub.publish(conversationId, {
      type: SseType.CONVERSATION_UPDATED,
      conversation: toApiConversationRow(
        deleted,
        conversationCostsUsdById().get(conversationId) ?? 0,
      ),
    });
    return c.json(
      toApiConversationRow(deleted, conversationCostsUsdById().get(conversationId) ?? 0),
    );
  });

  r.post("/:conversationId/undelete", (c) => {
    const conversationId = c.req.param("conversationId");
    const restored = runtime.conversations.undelete(conversationId);
    if (!restored) return c.json({ detail: "conversation not found or not deleted" }, 404);
    runtime.hub.publish(conversationId, {
      type: SseType.CONVERSATION_UPDATED,
      conversation: toApiConversationRow(
        restored,
        conversationCostsUsdById().get(conversationId) ?? 0,
      ),
    });
    return c.json(
      toApiConversationRow(restored, conversationCostsUsdById().get(conversationId) ?? 0),
    );
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

  return r;
}
