import { streamTotalTokens } from "@/lib/providerCost";
import { isThoughtEntry, type ChatEntry } from "@/protocol/chatEntry";

export function displayStatus(status: string): string {
  return status === "completed" ? "" : status;
}

export function entryPreview(entry: ChatEntry): string {
  if (entry.type === "user-message" || entry.type === "assistant-message") {
    const text = entry.text.trim();
    return text.length > 0 ? text : "(empty message)";
  }
  if (entry.type === "tool-invocation") return `Tool: ${entry.toolId || "unknown"}`;
  if (entry.type === "checkpoint-summary") {
    const head = entry.summaryText.trim().split(/\s+/).slice(0, 12).join(" ");
    return head ? `Summary: ${head}…` : "Summary";
  }
  if (entry.type === "context-injection") {
    const injectedCount = entry.files.filter((f) => f.status === "injected").length;
    return injectedCount > 0
      ? `Preinjected ${injectedCount} file${injectedCount === 1 ? "" : "s"}`
      : "No context files found";
  }
  if (entry.type === "retrieval") {
    if (entry.state === "pending" && entry.queries.length === 0) return "Planning retrieval…";
    if (entry.state === "pending") return "Retrieving…";
    if (entry.state === "failed") return "Retrieval failed";
    return entry.hits.length > 0
      ? `Retrieved ${entry.hits.length} excerpt${entry.hits.length === 1 ? "" : "s"}`
      : "Retrieval found nothing";
  }
  if (!isThoughtEntry(entry)) return String((entry as ChatEntry).type);
  if (entry.thoughtType === "summarize_attachment") {
    const name = String(entry.filename ?? "").trim();
    const status = displayStatus(String(entry.status || "").trim());
    return [status, name ? `Summarize: ${name}` : "Summarize attachment"].filter((x) => x.length > 0).join(" ");
  }
  // Sibling thoughts can be reprocess forks — say which part changed so the
  // branch list distinguishes "edited context" / "edited response" retries
  // from ordinary continuations at the same parent.
  const forkLabel =
    entry.forkPoint === "reason" ? "edited response" : entry.forkPoint === "context" ? "edited context" : "";
  const title = String(entry.title ?? "").trim();
  const status = displayStatus(String(entry.status || "").trim());
  const totalTokens = streamTotalTokens(entry);
  const tokenLabel = totalTokens > 0 ? `${totalTokens} tok` : "";
  const model = String(entry.llm?.model || "").trim();
  const meta = [forkLabel, status, model, tokenLabel].filter((x) => x.length > 0).join(" · ");
  return [title, meta].filter((x) => x.length > 0).join(" — ");
}

export function entryIconName(
  entry: ChatEntry,
): "user" | "bot" | "wrench" | "file" | "sparkles" | "message" | "dot" {
  if (entry.type === "user-message") return "user";
  if (entry.type === "assistant-message") return "bot";
  if (entry.type === "tool-invocation") return "wrench";
  if (entry.type === "context-injection") return "file";
  if (entry.type === "retrieval") return "file";
  if (isThoughtEntry(entry)) {
    const toolName = String(entry.toolName || "").trim();
    const action = String(entry.action || "").trim();
    const usesTool = Boolean(toolName) || action === "tool_call";
    return usesTool ? "wrench" : "sparkles";
  }
  return "dot";
}
