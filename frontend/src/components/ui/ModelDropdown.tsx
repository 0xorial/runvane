import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DropdownItem, ModelGroup } from "../../pages/settings/helpers";
import { TextInput } from "./TextInput";
import { cn } from "@/lib/utils";

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
};

export function ModelDropdown({
  value,
  onChange,
  groups,
  placeholder = "Select model",
  searchPlaceholder = "Search model",
  footer,
  disabled = false,
}: ModelDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      const t = e.target;
      if (t instanceof Node && !rootRef.current.contains(t)) setOpen(false);
    }
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase?.();
      const isTypingInField =
        tag === "input" || tag === "textarea" || target?.isContentEditable;
      if (isTypingInField) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Backspace") {
        e.preventDefault();
        setQuery((prev) => prev.slice(0, -1));
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key.length === 1) {
        setQuery((prev) => prev + e.key);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const normalizedQuery = normalizeToken(query);

  const filteredGroups = useMemo(() => {
    const qRaw = query.trim().toLowerCase();
    if (!qRaw) return groups;
    return groups
      .map((g) => {
        const models = (g.models || []).filter((m) => {
          const raw = itemLabel(m).toLowerCase();
          return (
            raw.includes(qRaw) || normalizeToken(raw).includes(normalizedQuery)
          );
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
    <div className={cn("relative w-full", disabled && "[&_button]:cursor-not-allowed [&_button]:opacity-55")} ref={rootRef}>
      <button
        type="button"
        className="flex min-h-[28px] w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-2.5 py-1 text-left text-sm text-foreground"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate whitespace-nowrap",
            !selectedLabel && "text-muted-foreground",
          )}
        >
          {selectedLabel || placeholder}
        </span>
        <span
          className={cn(
            "text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
        >
          ⌄
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[1400] overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
          <div className="border-b border-border p-2.5">
            <TextInput
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
                {g.label ? (
                  <div className="px-1.5 py-1 text-xs font-bold text-muted-foreground">
                    {g.label}
                  </div>
                ) : null}
                {g.models.map((m) => {
                  const v = itemValue(m);
                  const l = itemLabel(m);
                  return (
                    <button
                      key={`${g.id}:${v}`}
                      type="button"
                      className={cn(
                        "w-full cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-2 text-left font-mono text-sm text-foreground hover:bg-primary/10",
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
        </div>
      ) : null}
    </div>
  );
}
