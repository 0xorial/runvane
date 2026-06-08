import { useState } from "react";
import { GitBranch } from "lucide-react";
import { reprocessThoughtContext } from "@/api/client";
import type { ThoughtPrepareEntry, ThoughtStreamEntry } from "@/protocol/chatEntry";
import { ModelDropdown } from "@/components/ui/ModelDropdown";
import { useLlmSettings } from "@/hooks/llmSettingsContext";
import { useChatSessionContext } from "@/hooks/chatSessionContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notifyError } from "@/utils/toast";

const HINT = "Try with different model";

export function TryModelBranchButton({
  prepareEntry,
  stream,
  conversationId,
}: {
  prepareEntry: ThoughtPrepareEntry;
  stream?: ThoughtStreamEntry | null;
  conversationId: string;
}) {
  const { setActiveLeaf } = useChatSessionContext();
  const { modelGroups } = useLlmSettings();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isRebranching, setIsRebranching] = useState(false);

  const requestText = String(prepareEntry.requestText ?? stream?.llmRequest ?? "").trim();
  const canRebranch = requestText.length > 0 && !isRebranching;

  const rebranchWithModel = async (model: string, providerId?: string) => {
    const pid = String(providerId ?? "").trim();
    const modelName = String(model ?? "").trim();
    if (!pid || !modelName || !requestText) return;
    setPickerOpen(false);
    setIsRebranching(true);
    try {
      const result = await reprocessThoughtContext(conversationId, prepareEntry.id, {
        editedRequestText: requestText,
        llm: { providerId: pid, model: modelName },
      });
      await setActiveLeaf(result.data.leafEntryId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notifyError(`Failed to branch with model: ${detail}`);
    } finally {
      setIsRebranching(false);
    }
  };

  return (
    <div className="relative inline-flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <button
              type="button"
              data-testid="thought-prepare-try-model"
              className="inline-flex items-center gap-0.5 rounded bg-secondary/60 px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={HINT}
              disabled={!canRebranch}
              onClick={(e) => {
                e.stopPropagation();
                setPickerOpen((v) => !v);
              }}
            >
              <GitBranch className={`h-3 w-3 ${isRebranching ? "animate-spin" : ""}`} />
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{HINT}</TooltipContent>
      </Tooltip>
      {pickerOpen ? (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-56"
          role="presentation"
          onClick={(e) => e.stopPropagation()}
        >
          <ModelDropdown
            value=""
            placeholder="Choose model…"
            searchPlaceholder="Search model"
            initialOpen
            groups={modelGroups}
            disabled={isRebranching}
            buttonClassName="min-h-[26px] text-xs"
            onOpenChange={(open) => {
              if (!open) setPickerOpen(false);
            }}
            onChange={(model, providerId) => {
              void rebranchWithModel(model, providerId);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
