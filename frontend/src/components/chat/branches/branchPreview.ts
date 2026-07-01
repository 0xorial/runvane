import { streamTotalTokens } from "@/lib/providerCost";
import { isThoughtStreamEntry, type ChatEntry } from "@/protocol/chatEntry";

export function displayStatus(status: string): string {
  return status === "completed" ? "" : status;
}

export function entryPreview(entry: ChatEntry): string {
  if (entry.type === "user-message" || entry.type === "assistant-message") {
    const text = entry.text.trim();
    return text.length > 0 ? text : "(empty message)";
  }
  if (entry.type === "tool-invocation") return `Tool: ${entry.toolId || "unknown"}`;
  if (entry.type === "thought-prepare") {
    const summary = String(entry.title || "").trim();
    if (summary) return summary;
    const model = String(entry.llm?.model || "").trim();
    return model || "(context)";
  }
  if (entry.type === "thought-action") {
    const status = displayStatus(String(entry.status || "running").trim());
    const action = String(entry.action || "").trim();
    const toolName = String(entry.toolName || "").trim();
    const meta = [action, toolName].filter((x) => x.length > 0).join(" ");
    const body = [status, meta].filter((x) => x.length > 0).join(" ");
    return body ? `Decided: ${body}` : "Decided";
  }
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
  if (entry.type === "thought_stream" && entry.thoughtType === "summarize_attachment") {
    const name = String(entry.filename ?? "").trim();
    const status = displayStatus(String(entry.status || "running").trim());
    return [status, name ? `Summarize: ${name}` : "Summarize attachment"].filter((x) => x.length > 0).join(" ");
  }
  if (!isThoughtStreamEntry(entry)) return String((entry as ChatEntry).type);
  const status = displayStatus(String(entry.status || "running").trim());
  const totalTokens = streamTotalTokens(entry);
  const tokenLabel = totalTokens > 0 ? `${totalTokens} tok` : "";
  const model = String(entry.llm?.model || "").trim();
  const meta = [model, tokenLabel].filter((x) => x.length > 0).join(" ");
  return [status, meta].filter((x) => x.length > 0).join(" ");
}

export function entryIconName(
  entry: ChatEntry,
): "user" | "bot" | "wrench" | "file" | "sparkles" | "message" | "dot" {
  if (entry.type === "user-message") return "user";
  if (entry.type === "assistant-message") return "bot";
  if (entry.type === "tool-invocation") return "wrench";
  if (entry.type === "thought-prepare") return "file";
  if (entry.type === "context-injection") return "file";
  if (isThoughtStreamEntry(entry)) return "sparkles";
  if (entry.type === "thought-action") {
    const toolName = String(entry.toolName || "").trim();
    const action = String(entry.action || "").trim();
    const usesTool = Boolean(toolName) || action === "tool_call";
    return usesTool ? "wrench" : "message";
  }
  return "dot";
}
