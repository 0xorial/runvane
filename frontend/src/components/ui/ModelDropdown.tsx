import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DropdownItem, ModelGroup } from "../../pages/settings/helpers";
import { TextInput } from "./TextInput";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

function normalizeToken(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function itemValue(item: DropdownItem): string {
  return typeof item === "string" ? item : item.value;
}

function itemLabel(item: DropdownItem): string {
  return typeof item === "string" ? item : item.label;
}

type ModelDropdownProps = {
  value: string;
  onChange: (value: string, groupId?: string) => void;
  groups: ModelGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  footer?: ReactNode;
  disabled?: boolean;
  buttonClassName?: string;
};

export function ModelDropdown({
  value,
  onChange,
  groups,
  placeholder = "Select model",
  searchPlaceholder = "Search model",
  footer,
  disabled = false,
  buttonClassName,
}: ModelDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const normalizedQuery = normalizeToken(query);

  const filteredGroups = useMemo(() => {
    const qRaw = query.trim().toLowerCase();
    if (!qRaw) return groups;
    return groups
      .map((g) => {
        const models = (g.models || []).filter((m) => {
          const raw = itemLabel(m).toLowerCase();
          return raw.includes(qRaw) || normalizeToken(raw).includes(normalizedQuery);
        });
        return { ...g, models };
      })
      .filter((g) => g.models.length > 0);
  }, [groups, query, normalizedQuery]);

  const selectedLabel = useMemo(() => {
    for (const g of groups) {
      for (const m of g.models || []) {
        if (itemValue(m) === value) return itemLabel(m);
      }
    }
    return value || "";
  }, [groups, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-h-[28px] w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-2.5 py-1 text-left text-sm text-foreground",
            disabled && "cursor-not-allowed opacity-55",
            buttonClassName,
          )}
          disabled={disabled}
        >
          <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", !selectedLabel && "text-muted-foreground")}>
            {selectedLabel || placeholder}
          </span>
          <span
            className={cn(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground transition-transform duration-150",
              open && "rotate-180",
            )}
            aria-hidden
          >
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={6}
        className="z-[1400] w-fit max-w-[90vw] overflow-hidden rounded-lg border border-border bg-popover p-0 shadow-xl"
      >
        <div className="border-b border-border p-2.5">
          <TextInput
            inputRef={searchInputRef}
            value={query}
            onChange={setQuery}
            placeholder={searchPlaceholder}
            className="box-border w-full rounded-md border border-input bg-muted/40 py-1.5 pl-2 pr-8 text-sm"
            showClearButton
            wrapperClassName="relative block"
            clearButtonClassName="absolute right-1.5 top-1/2 flex h-[18px] w-[18px] -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background p-0 leading-none text-muted-foreground"
            clearAriaLabel="Clear search"
          />
        </div>

        <div className="max-h-[300px] overflow-auto px-2 pb-2 pt-1.5">
          {filteredGroups.length === 0 ? (
            <div className="px-1.5 py-2 text-[13px] text-muted-foreground">No results</div>
          ) : null}
          {filteredGroups.map((g) => (
            <div key={g.id} className="mt-1.5 first:mt-0">
              {g.label ? <div className="px-1.5 py-1 text-xs font-bold text-muted-foreground">{g.label}</div> : null}
              {g.models.map((m) => {
                const v = itemValue(m);
                const l = itemLabel(m);
                return (
                  <button
                    key={`${g.id}:${v}`}
                    type="button"
                    className={cn(
                      "block cursor-pointer whitespace-nowrap rounded-md border-0 bg-transparent px-2.5 py-2 text-left font-mono text-sm text-foreground hover:bg-primary/10",
                      v === value && "bg-primary/15",
                    )}
                    onClick={() => {
                      onChange(v, g.id);
                      setOpen(false);
                    }}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {footer ? (
          <div className="border-t border-border px-3 py-2 text-[13px] [&_a]:cursor-pointer [&_a]:font-semibold [&_a]:text-primary [&_a]:no-underline hover:[&_a]:underline [&_button]:cursor-pointer [&_button]:border-0 [&_button]:bg-transparent [&_button]:p-0 [&_button]:font-semibold [&_button]:text-primary">
            {footer}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
