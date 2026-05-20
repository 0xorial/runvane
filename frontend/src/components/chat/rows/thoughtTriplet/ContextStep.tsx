import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { reprocessThoughtContext } from "@/api/client";
import type { ThoughtPrepareEntry, ThoughtStreamEntry } from "@/protocol/chatEntry";
import { notifyError } from "@/utils/toast";
import { useLlmSettings } from "@/hooks/llmSettingsContext";
import { ModelSelector } from "@/components/ui/ModelSelector";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { llmRequestJsonSchema } from "@/lib/editorSchemas";
import { ReadOnlySection } from "./ReadOnlySection";

export function ContextStep({
  prepareEntry,
  stream,
  conversationId,
}: {
  prepareEntry: ThoughtPrepareEntry;
  stream: ThoughtStreamEntry;
  conversationId: string;
}) {
  const prompt = useMemo(() => (prepareEntry.requestText ?? stream.llmRequest ?? "").trim(), [prepareEntry.requestText, stream.llmRequest]);
  const currentProviderId = String(prepareEntry.llmProviderId ?? stream.llmProviderId ?? "").trim();
  const currentModel = String(prepareEntry.llmModel ?? stream.llmModel ?? "").trim();
  const [isEditing, setIsEditing] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(prompt);
  const [selectedProviderId, setSelectedProviderId] = useState(currentProviderId);
  const [selectedModel, setSelectedModel] = useState(currentModel);
  const { modelGroups } = useLlmSettings();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isEditing) return;
    setEditedPrompt(prompt);
    setSelectedProviderId(currentProviderId);
    setSelectedModel(currentModel);
  }, [currentModel, currentProviderId, isEditing, prompt]);

  const canApply =
    editedPrompt.trim().length > 0 &&
    selectedProviderId.trim().length > 0 &&
    selectedModel.trim().length > 0 &&
    !isSaving;

  const applyEdit = async () => {
    if (!canApply) return;
    setIsSaving(true);
    try {
      await reprocessThoughtContext(conversationId, prepareEntry.id, {
        editedRequestText: editedPrompt.trim(),
        llmProviderId: selectedProviderId.trim(),
        llmModel: selectedModel.trim(),
      });
      setIsEditing(false);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notifyError(`Failed to reprocess context: ${detail}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-1.5 ml-1 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{currentProviderId && currentModel ? `model: ${currentProviderId}/${currentModel}` : "model: unknown"}</span>
        <button
          type="button"
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onClick={() => setIsEditing((v) => !v)}
          title="Edit context and branch"
        >
          <Pencil className="h-3 w-3" />
          {isEditing ? "Close edit" : "Edit"}
        </button>
      </div>
      {isEditing ? (
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Model</div>
          <ModelSelector
            value={selectedModel}
            onChange={(model, providerId) => {
              setSelectedModel(model);
              if (providerId) setSelectedProviderId(String(providerId).trim());
            }}
            modelGroups={modelGroups}
            placeholder="Select model"
            searchPlaceholder="Search model"
          />
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Prompt</div>
          <CodeEditor
            value={editedPrompt}
            onChange={setEditedPrompt}
            language="json"
            height={260}
            jsonSchema={llmRequestJsonSchema}
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded border border-border/70 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
              onClick={() => {
                setEditedPrompt(prompt);
                setSelectedProviderId(currentProviderId);
                setSelectedModel(currentModel);
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
        <ReadOnlySection label="Prompt" value={prompt} />
      )}
    </div>
  );
}
