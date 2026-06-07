export type SettingRow = { id: number; key: string; value: string };

export function valueToInputString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return String(value ?? "");
  return JSON.stringify(value);
}

export function settingsToRows(settings: Record<string, unknown>): SettingRow[] {
  return Object.entries(settings).map(([key, value], index) => ({
    id: index + 1,
    key,
    value: valueToInputString(value),
  }));
}

export function rowsToSettings(rows: SettingRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    out[key] = row.value;
  }
  return out;
}
