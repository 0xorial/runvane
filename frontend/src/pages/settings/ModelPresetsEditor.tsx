import { useEffect, useRef, useState } from "react";
import type { ModelPresetResponse } from "../../../../backend/src/routes/modelPresets.types";
import { AsyncButton } from "../../components/ui/AsyncButton";
import { notifyError } from "../../utils/toast";
import { cn } from "@/lib/utils";
import {
  chipActive,
  chipBase,
  ghostBtn,
  ghostDanger,
  loadError as loadErrorBanner,
  loadHint,
} from "./settingsClasses";

type ModelPresetsEditorProps = {
  presets: ModelPresetResponse[];
  presetEditId: number | null;
  setPresetEditId: (id: number) => void;
  currentPreset: ModelPresetResponse | null;
  setCurrentPreset: (preset: ModelPresetResponse) => void;
  loading: boolean;
  loadError: string | null;
  createPreset: () => Promise<void>;
  savePreset: () => Promise<boolean>;
  deletePreset: () => Promise<void>;
};

type SettingRow = {
  id: number;
  key: string;
  value: string;
};

function valueToInputString(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    return String(value ?? "");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function settingsToRows(settings: Record<string, unknown>): SettingRow[] {
  return Object.entries(settings).map(([key, value], index) => ({
    id: index + 1,
    key,
    value: valueToInputString(value),
  }));
}

function rowsToSettings(rows: SettingRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    out[key] = row.value;
  }
  return out;
}

const inputBase =
  "box-border min-h-[30px] w-full rounded-md border border-input bg-background px-3 text-sm";

export function ModelPresetsEditor({
  presets,
  presetEditId,
  setPresetEditId,
  currentPreset,
  setCurrentPreset,
  loading,
  loadError,
  createPreset,
  savePreset,
  deletePreset,
}: ModelPresetsEditorProps) {
  const [settingRows, setSettingRows] = useState<SettingRow[]>([]);
  const nextSettingRowIdRef = useRef(1);

  useEffect(() => {
    if (!currentPreset) {
      setSettingRows([]);
      nextSettingRowIdRef.current = 1;
      return;
    }
    const rows = settingsToRows(currentPreset.parameters ?? {});
    if (rows.length === 0) {
      setSettingRows([{ id: 1, key: "", value: "" }]);
      nextSettingRowIdRef.current = 2;
      return;
    }
    setSettingRows(rows);
    nextSettingRowIdRef.current = rows.length + 1;
  }, [currentPreset?.id]);

  const canEdit = !loading && !loadError && currentPreset != null;

  function commitRows(nextRows: SettingRow[]) {
    if (!currentPreset) return;
    setCurrentPreset({
      ...currentPreset,
      parameters: rowsToSettings(nextRows),
    });
  }

  function updateSettingRow(
    rowId: number,
    field: "key" | "value",
    nextValue: string,
  ) {
    const nextRows = settingRows.map((row) =>
      row.id === rowId ? { ...row, [field]: nextValue } : row,
    );
    setSettingRows(nextRows);
    commitRows(nextRows);
  }

  function addSettingRow() {
    const nextRows = [
      ...settingRows,
      { id: nextSettingRowIdRef.current, key: "", value: "" },
    ];
    nextSettingRowIdRef.current += 1;
    setSettingRows(nextRows);
    commitRows(nextRows);
  }

  function removeSettingRow(rowId: number) {
    const nextRows = settingRows.filter((row) => row.id !== rowId);
    const safeRows = nextRows.length > 0 ? nextRows : [{ id: nextSettingRowIdRef.current++, key: "", value: "" }];
    setSettingRows(safeRows);
    commitRows(safeRows);
  }

  async function handleAdd() {
    try {
      await createPreset();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to create model preset");
    }
  }

  async function handleDelete() {
    if (!currentPreset) return;
    if (!window.confirm(`Delete preset #${currentPreset.id}?`)) return;
    try {
      await deletePreset();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to delete model preset");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2.5">
        <button type="button" className={ghostBtn} onClick={() => void handleAdd()}>
          Add preset
        </button>
        <div className="flex flex-wrap gap-2" role="list" aria-label="Model presets">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              role="listitem"
              className={cn(chipBase, "max-w-none", p.id === presetEditId && chipActive)}
              onClick={() => setPresetEditId(p.id)}
              title={p.name}
            >
              #{p.id} {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        {loading ? <div className={loadHint}>Loading preset…</div> : null}
        {loadError ? (
          <div className={loadErrorBanner} role="alert">
            Failed to load preset: {loadError}
          </div>
        ) : null}
        {currentPreset ? (
          <>
            <div className="grid grid-cols-1 gap-3">
              <label className="text-sm text-muted-foreground">
                Name
                <input
                  className={cn(inputBase, "mt-1.5 w-full min-w-0")}
                  value={currentPreset.name}
                  disabled={!canEdit}
                  onChange={(e) => setCurrentPreset({ ...currentPreset, name: e.target.value })}
                />
              </label>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Parameters</span>
                <button
                  type="button"
                  className={ghostBtn}
                  disabled={!canEdit}
                  onClick={() => addSettingRow()}
                >
                  Add parameter
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-2.5">
                {settingRows.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <input
                      className={inputBase}
                      placeholder="key"
                      value={row.key}
                      disabled={!canEdit}
                      onChange={(e) => updateSettingRow(row.id, "key", e.target.value)}
                    />
                    <input
                      className={inputBase}
                      placeholder="value"
                      value={row.value}
                      disabled={!canEdit}
                      onChange={(e) => updateSettingRow(row.id, "value", e.target.value)}
                    />
                    <button
                      type="button"
                      className={cn(ghostBtn, ghostDanger, "whitespace-nowrap")}
                      disabled={!canEdit}
                      onClick={() => removeSettingRow(row.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                className={cn(ghostBtn, ghostDanger)}
                onClick={() => void handleDelete()}
              >
                Delete
              </button>
              <AsyncButton className={ghostBtn} disabled={!canEdit} onClickAsync={savePreset}>
                Save
              </AsyncButton>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
