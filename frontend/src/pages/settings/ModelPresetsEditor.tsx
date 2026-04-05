import { useEffect, useRef, useState } from "react";
import type { ModelPresetResponse } from "../../../../backend/src/routes/modelPresets.types";
import { AsyncButton } from "../../components/ui/AsyncButton";
import { notifyError } from "../../utils/toast";
import { cx } from "../../utils/cx";
import styles from "./ModelPresetsEditor.module.css";

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
    <div className={styles.layout}>
      <div className={styles.topRow}>
        <button type="button" className={styles.ghostBtn} onClick={() => void handleAdd()}>
          Add preset
        </button>
        <div className={styles.chips} role="list" aria-label="Model presets">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              role="listitem"
              className={cx(styles.chip, p.id === presetEditId && styles.chipActive)}
              onClick={() => setPresetEditId(p.id)}
              title={p.name}
            >
              #{p.id} {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.card}>
        {loading ? <div className={styles.hint}>Loading preset…</div> : null}
        {loadError ? (
          <div className={styles.error} role="alert">
            Failed to load preset: {loadError}
          </div>
        ) : null}
        {currentPreset ? (
          <>
            <div className={styles.formGrid}>
              <label>
                Name
                <input
                  className={`input control ${styles.modelNameInput}`}
                  value={currentPreset.name}
                  disabled={!canEdit}
                  onChange={(e) => setCurrentPreset({ ...currentPreset, name: e.target.value })}
                />
              </label>
            </div>

            <div className={styles.settingsLabel}>
              <div className={styles.settingsHeader}>
                <span>Parameters</span>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  disabled={!canEdit}
                  onClick={() => addSettingRow()}
                >
                  Add parameter
                </button>
              </div>
              <div className={styles.settingsRows}>
                {settingRows.map((row) => (
                  <div key={row.id} className={styles.settingsRow}>
                    <input
                      className={`input ${styles.paramKeyInput}`}
                      placeholder="key"
                      value={row.key}
                      disabled={!canEdit}
                      onChange={(e) => updateSettingRow(row.id, "key", e.target.value)}
                    />
                    <input
                      className={`input ${styles.paramValueInput}`}
                      placeholder="value"
                      value={row.value}
                      disabled={!canEdit}
                      onChange={(e) => updateSettingRow(row.id, "value", e.target.value)}
                    />
                    <button
                      type="button"
                      className={cx(styles.ghostBtn, styles.danger, styles.removeParamBtn)}
                      disabled={!canEdit}
                      onClick={() => removeSettingRow(row.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={cx(styles.ghostBtn, styles.danger)}
                onClick={() => void handleDelete()}
              >
                Delete
              </button>
              <AsyncButton className={styles.ghostBtn} disabled={!canEdit} onClickAsync={savePreset}>
                Save
              </AsyncButton>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
