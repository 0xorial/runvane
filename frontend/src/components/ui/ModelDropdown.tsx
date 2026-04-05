import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DropdownItem, ModelGroup } from "../../pages/settings/helpers";
import { TextInput } from "./TextInput";
import { cx } from "../../utils/cx";
import styles from "./ModelDropdown.module.css";

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
    <div
      className={cx(styles.root, disabled && styles.disabled)}
      ref={rootRef}
    >
      <button
        type="button"
        className={styles.trigger}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <span
          className={cx(styles.value, !selectedLabel && styles.placeholder)}
        >
          {selectedLabel || placeholder}
        </span>
        <span className={cx(styles.caret, open && styles.caretOpen)}>⌄</span>
      </button>

      {open ? (
        <div className={styles.menu}>
          <div className={styles.search}>
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder={searchPlaceholder}
              className={styles.searchInput}
              showClearButton
              wrapperClassName={styles.searchWrap}
              clearButtonClassName={styles.searchClear}
              clearAriaLabel="Clear search"
            />
          </div>

          <div className={styles.list}>
            {filteredGroups.length === 0 ? (
              <div className={styles.empty}>No results</div>
            ) : null}
            {filteredGroups.map((g) => (
              <div key={g.id} className={styles.group}>
                {g.label ? (
                  <div className={styles.groupTitle}>{g.label}</div>
                ) : null}
                {g.models.map((m) => {
                  const v = itemValue(m);
                  const l = itemLabel(m);
                  return (
                    <button
                      key={`${g.id}:${v}`}
                      type="button"
                      className={cx(
                        styles.item,
                        v === value && styles.itemActive,
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

          {footer ? <div className={styles.footer}>{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
