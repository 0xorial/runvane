import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { reprocessThought } from "@/api/client";
import type { PlannerLlmStreamEntry, TitleLlmStreamEntry } from "@/protocol/chatEntry";
import { notifyError } from "@/utils/toast";
import { displayStatus } from "./meta";
import { ReadOnlySection } from "./ReadOnlySection";

export function ReasoningStep({
  stream,
  conversationId,
}: {
  stream: PlannerLlmStreamEntry | TitleLlmStreamEntry;
  conversationId: string | null;
}) {
  const response = String(stream.llmResponse || "").trim();
  const [isEditing, setIsEditing] = useState(false);
  const [editedResponse, setEditedResponse] = useState(response);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isEditing) setEditedResponse(response);
  }, [response, isEditing]);

  const promptTokens = stream.promptTokens ?? 0;
  const cachedPromptTokens = stream.cachedPromptTokens ?? 0;
  const completionTokens = stream.completionTokens ?? 0;
  const duration = stream.thoughtMs != null ? `${Math.round(stream.thoughtMs)}ms` : "running";
  const statusLabel = displayStatus(stream.status ?? "running");
  const canEdit = Boolean(conversationId) && response.length > 0;
  const canApply = editedResponse.trim().length > 0 && !isSaving;

  const applyEdit = async () => {
    const cid = conversationId;
    if (!cid || !canApply) return;
    setIsSaving(true);
    try {
      await reprocessThought(cid, stream.id, editedResponse.trim());
      setIsEditing(false);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notifyError(`Failed to reprocess thought: ${detail}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-1.5 ml-1 space-y-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          {statusLabel ? <span>status: {statusLabel}</span> : null}
          <span>prompt: {promptTokens}t</span>
          <span>cached: {cachedPromptTokens}t</span>
          <span>completion: {completionTokens}t</span>
          <span>duration: {duration}</span>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={() => setIsEditing((v) => !v)}
            title="Edit reasoning and branch"
          >
            <Pencil className="h-3 w-3" />
            {isEditing ? "Close edit" : "Edit"}
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Edit response</div>
          <textarea
            className="h-28 w-full resize-y rounded border border-border/70 bg-background px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground focus:outline-none"
            value={editedResponse}
            onChange={(event) => setEditedResponse(event.currentTarget.value)}
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded border border-border/70 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
              onClick={() => {
                setEditedResponse(response);
                setIsEditing(false);
              }}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded border border-primary/50 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                void applyEdit();
              }}
              disabled={!canApply}
            >
              {isSaving ? "Applying..." : "Apply"}
            </button>
          </div>
        </div>
      ) : (
        <ReadOnlySection label="Raw response" value={response} />
      )}

      {stream.status === "failed" || stream.status === "cancelled" ? <ReadOnlySection label="Error" value={String(stream.error || "")} danger /> : null}
    </div>
  );
}
