<script lang="ts">
  import type { ModelPresetResponse } from "../../../../backend/src/contracts/model-presets";
  import AsyncButton from "@/components/ui/AsyncButton.svelte";
  import { notifyError } from "@/utils/toast";
  import { rowsToSettings, settingsToRows, type SettingRow } from "./presetRows";
  import { chipActive, chipBase, ghostBtn, ghostDanger, loadError, loadHint } from "./settingsClasses";

  let {
    presets,
    presetEditId,
    setPresetEditId,
    currentPreset,
    setCurrentPreset,
    loading,
    loadError: presetLoadError,
    createPreset,
    savePreset,
    deletePreset,
  }: {
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
  } = $props();

  let settingRows = $state<SettingRow[]>([]);
  let nextSettingRowId = $state(1);

  const canEdit = $derived(!loading && !presetLoadError && currentPreset != null);

  $effect(() => {
    if (!currentPreset) {
      settingRows = [];
      nextSettingRowId = 1;
      return;
    }
    const rows = settingsToRows(currentPreset.parameters ?? {});
    if (rows.length === 0) {
      settingRows = [{ id: 1, key: "", value: "" }];
      nextSettingRowId = 2;
      return;
    }
    settingRows = rows;
    nextSettingRowId = rows.length + 1;
  });

  function commitRows(nextRows: SettingRow[]): void {
    if (!currentPreset) return;
    setCurrentPreset({ ...currentPreset, parameters: rowsToSettings(nextRows) });
  }

  function updateSettingRow(rowId: number, field: "key" | "value", nextValue: string): void {
    const nextRows = settingRows.map((row) => (row.id === rowId ? { ...row, [field]: nextValue } : row));
    settingRows = nextRows;
    commitRows(nextRows);
  }

  function addSettingRow(): void {
    const nextRows = [...settingRows, { id: nextSettingRowId, key: "", value: "" }];
    nextSettingRowId += 1;
    settingRows = nextRows;
    commitRows(nextRows);
  }

  function removeSettingRow(rowId: number): void {
    const nextRows = settingRows.filter((row) => row.id !== rowId);
    const safeRows = nextRows.length > 0 ? nextRows : [{ id: nextSettingRowId++, key: "", value: "" }];
    settingRows = safeRows;
    commitRows(safeRows);
  }

  async function handleAdd(): Promise<void> {
    try {
      await createPreset();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to create model preset");
    }
  }

  async function handleDelete(): Promise<void> {
    if (!currentPreset) return;
    if (!window.confirm(`Delete preset #${currentPreset.id}?`)) return;
    try {
      await deletePreset();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to delete model preset");
    }
  }
</script>

<div class="flex flex-col gap-3">
  <div class="flex flex-wrap items-start gap-2.5">
    <div class="flex flex-wrap gap-2" role="list" aria-label="Model presets">
      {#each presets as preset (preset.id)}
        <button
          type="button"
          class="{chipBase} max-w-none {preset.id === presetEditId ? chipActive : ''}"
          title={preset.name}
          onclick={() => setPresetEditId(preset.id)}
        >
          #{preset.id} {preset.name}
        </button>
      {/each}
    </div>
    <button type="button" class={ghostBtn} onclick={() => void handleAdd()}>+ Add preset</button>
  </div>

  <div class="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
    {#if loading}
      <div class={loadHint}>Loading preset…</div>
    {/if}
    {#if presetLoadError}
      <div class={loadError} role="alert">Failed to load preset: {presetLoadError}</div>
    {/if}
    {#if currentPreset}
      <label class="text-sm text-muted-foreground">
        Name
        <input
          class="mt-1.5 box-border min-h-[30px] w-full rounded-md border border-input bg-background px-3 text-sm"
          value={currentPreset.name}
          disabled={!canEdit}
          oninput={(e) => setCurrentPreset({ ...currentPreset, name: e.currentTarget.value })}
        />
      </label>

      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium">Parameters</span>
          <button type="button" class={ghostBtn} disabled={!canEdit} onclick={addSettingRow}>Add parameter</button>
        </div>
        <div class="mt-2 flex flex-col gap-2.5">
          {#each settingRows as row (row.id)}
            <div class="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input
                class="box-border min-h-[30px] w-full rounded-md border border-input bg-background px-3 text-sm"
                placeholder="key"
                value={row.key}
                disabled={!canEdit}
                oninput={(e) => updateSettingRow(row.id, "key", e.currentTarget.value)}
              />
              <input
                class="box-border min-h-[30px] w-full rounded-md border border-input bg-background px-3 text-sm"
                placeholder="value"
                value={row.value}
                disabled={!canEdit}
                oninput={(e) => updateSettingRow(row.id, "value", e.currentTarget.value)}
              />
              <button
                type="button"
                class="{ghostBtn} {ghostDanger} whitespace-nowrap"
                disabled={!canEdit}
                onclick={() => removeSettingRow(row.id)}
              >
                Remove
              </button>
            </div>
          {/each}
        </div>
      </div>

      <div class="flex justify-end gap-2.5">
        <button type="button" class="{ghostBtn} {ghostDanger}" onclick={() => void handleDelete()}>Delete</button>
        <AsyncButton class={ghostBtn} disabled={!canEdit} onclick={async () => { await savePreset(); }}>Save</AsyncButton>
      </div>
    {/if}
  </div>
</div>
