import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AGENT_COLORS, AGENT_COLOR_DEFAULT, getAgentColor } from "./agentColors";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type AgentColorPickerProps = {
  value: string | null;
  onChange: (colorId: string | null) => void;
  disabled?: boolean;
};

export function AgentColorPicker({ value, onChange, disabled = false }: AgentColorPickerProps) {
  const [open, setOpen] = useState(false);
  const current = getAgentColor(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`Color: ${current.label}`}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-muted/40 px-2 text-foreground transition-colors hover:bg-secondary/60",
            disabled && "cursor-not-allowed opacity-55",
          )}
        >
          <span className={cn("h-3.5 w-3.5 rounded-full", current.swatch)} />
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="z-[1400] w-fit rounded-lg border border-border bg-popover p-2 shadow-xl"
      >
        <div className="grid grid-cols-6 gap-1">
          <button
            type="button"
            title={AGENT_COLOR_DEFAULT.label}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:bg-primary/10",
              value == null && "border-primary/60 bg-primary/15",
            )}
          >
            <span className={cn("h-4 w-4 rounded-full", AGENT_COLOR_DEFAULT.swatch)} />
          </button>
          {AGENT_COLORS.map(({ id, label, swatch }) => {
            const selected = value === id;
            return (
              <button
                key={id}
                type="button"
                title={label}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:bg-primary/10",
                  selected && "border-primary/60 bg-primary/15",
                )}
              >
                <span className={cn("h-4 w-4 rounded-full", swatch)} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
