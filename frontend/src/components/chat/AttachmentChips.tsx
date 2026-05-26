import { FileText, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AttachmentMode } from "@/api/client";

export type SelectedAttachment = { file: File; mode: AttachmentMode };

type AttachmentChipsProps = {
  files: SelectedAttachment[];
  previewUrls: string[];
  onChangeMode: (index: number, mode: AttachmentMode) => void;
  onRemove: (index: number) => void;
};

export function AttachmentChips({ files, previewUrls, onChangeMode, onRemove }: AttachmentChipsProps) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {files.map(({ file, mode }, idx) => (
        <AttachmentChip
          key={`${file.name}-${file.size}-${idx}`}
          file={file}
          mode={mode}
          previewUrl={previewUrls[idx]}
          onChangeMode={(next) => onChangeMode(idx, next)}
          onRemove={() => onRemove(idx)}
        />
      ))}
    </div>
  );
}

type AttachmentChipProps = {
  file: File;
  mode: AttachmentMode;
  previewUrl: string | undefined;
  onChangeMode: (mode: AttachmentMode) => void;
  onRemove: () => void;
};

function AttachmentChip({ file, mode, previewUrl, onChangeMode, onRemove }: AttachmentChipProps) {
  return (
    <div className="group relative flex w-[150px] flex-col gap-1.5 rounded-md border border-border bg-card p-1.5 text-card-foreground">
      <button
        type="button"
        onClick={onRemove}
        title="Remove file"
        className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
      <Preview file={file} previewUrl={previewUrl} />
      <div className="truncate text-xs leading-tight" title={file.name}>
        {file.name}
      </div>
      <ModeToggle mode={mode} onChange={onChangeMode} />
    </div>
  );
}

function Preview({ file, previewUrl }: { file: File; previewUrl: string | undefined }) {
  if (!previewUrl) {
    return (
      <div className="flex h-[76px] w-full items-center justify-center rounded-md bg-muted text-[11px] font-bold tracking-wide text-muted-foreground">
        FILE
      </div>
    );
  }
  if (file.type === "application/pdf") {
    return <iframe className="h-[76px] w-full rounded-md border-0 bg-muted" src={previewUrl} title={file.name} />;
  }
  return <img className="h-[76px] w-full rounded-md object-cover" src={previewUrl} alt={file.name} />;
}

type ModeMeta = {
  value: AttachmentMode;
  label: string;
  icon: typeof FileText;
  tooltipTitle: string;
  tooltipBody: string;
};

const MODE_OPTIONS: readonly ModeMeta[] = [
  {
    value: "direct",
    label: "Direct",
    icon: FileText,
    tooltipTitle: "Direct (raw bytes)",
    tooltipBody:
      "The raw file is sent to the model every turn. Best for small images or short text where the model needs the ground-truth content. Burns tokens on every reply.",
  },
  {
    value: "summary",
    label: "Summary",
    icon: Sparkles,
    tooltipTitle: "Summarize (RAG subagent)",
    tooltipBody:
      "A one-shot summary is generated up front and shown to the planner instead of the raw file. The agent can call ask_attachment to query the full content on demand. Cheap on tokens, ideal for large PDFs, datasets, or long docs.",
  },
];

function ModeToggle({ mode, onChange }: { mode: AttachmentMode; onChange: (mode: AttachmentMode) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Attachment mode"
      className="grid grid-cols-2 rounded-md border border-border bg-muted/60 p-[2px]"
    >
      {MODE_OPTIONS.map((opt) => {
        const active = mode === opt.value;
        return (
          <Tooltip key={opt.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={opt.tooltipTitle}
                onClick={() => onChange(opt.value)}
                className={cn(
                  "flex h-6 items-center justify-center gap-1 rounded-[3px] px-1 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                    : "bg-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <opt.icon className="h-3 w-3" />
                <span>{opt.label}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
              <div className="mb-0.5 font-semibold">{opt.tooltipTitle}</div>
              <div className="text-popover-foreground/80">{opt.tooltipBody}</div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
