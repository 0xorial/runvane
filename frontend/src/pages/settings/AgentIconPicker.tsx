import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AGENT_ICONS, getAgentIcon } from "./agentIcons";
import { getAgentColor } from "./agentColors";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type AgentIconPickerProps = {
  value: string | null;
  colorId?: string | null;
  onChange: (iconId: string | null) => void;
  disabled?: boolean;
};

export function AgentIconPicker({ value, colorId, onChange, disabled = false }: AgentIconPickerProps) {
  const [open, setOpen] = useState(false);
  const CurrentIcon = getAgentIcon(value);
  const color = getAgentColor(colorId);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="Agent icon"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input transition-colors hover:opacity-90",
            color.wrap,
            disabled && "cursor-not-allowed opacity-55",
          )}
        >
          <CurrentIcon className="h-4 w-4" strokeWidth={1.85} />
          <ChevronDown className="ml-0.5 h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="z-[1400] w-fit rounded-lg border border-border bg-popover p-2 shadow-xl"
      >
        <div className="grid grid-cols-5 gap-1">
          {AGENT_ICONS.map(({ id, label, Icon }) => {
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
                  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-foreground hover:bg-primary/10",
                  selected && "border-primary/60 bg-primary/15",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.85} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
