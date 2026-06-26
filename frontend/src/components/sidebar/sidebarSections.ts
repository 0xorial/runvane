import type { ConversationGroupRow, ConversationRow } from "../../../../backend/src/contracts/conversations";

export type SidebarSection =
  | { kind: "conversation"; row: ConversationRow; latestMs: number }
  | {
      kind: "group";
      groupId: string;
      groupName: string;
      rows: ConversationRow[];
      /** Full conversation count for the group, ignoring the sidebar's
       * recent-N window. Falls back to `rows.length` when the backend doesn't
       * report per-group totals (unwindowed list or older backend). */
      totalCount: number;
      latestMs: number;
      latestTimestampIso: string;
    };

function parseTimestampMs(raw: string): number {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new Error(`invalid conversation timestamp: ${raw}`);
  }
  return ms;
}

function latestSectionTimestamp(rows: ConversationRow[]): { ms: number; raw: string } {
  return rows.reduce(
    (best, row) => {
      const raw = String(row.lastMessageAt || row.createdAt || row.updatedAt || "").trim();
      const ms = parseTimestampMs(raw);
      return ms > best.ms ? { ms, raw } : best;
    },
    { ms: Number.NEGATIVE_INFINITY, raw: "" },
  );
}

export function groupConversations(
  conversations: ConversationRow[],
  groups: ConversationGroupRow[],
  groupTotals?: Record<string, number>,
): SidebarSection[] {
  const ungrouped: ConversationRow[] = [];
  const byGroupId = new Map<string, ConversationRow[]>();
  const groupById = new Map<string, ConversationGroupRow>();
  for (const group of groups) {
    const id = String(group.id || "").trim();
    if (!id) continue;
    groupById.set(id, group);
  }
  for (const row of conversations) {
    const groupId = String(row.groupId || "").trim();
    if (!groupId) {
      ungrouped.push(row);
      continue;
    }
    const list = byGroupId.get(groupId) ?? [];
    list.push(row);
    byGroupId.set(groupId, list);
  }
  return [
    ...ungrouped.map((row) => ({
      kind: "conversation" as const,
      row,
      latestMs: parseTimestampMs(String(row.lastMessageAt || row.createdAt || row.updatedAt || "")),
    })),
    ...Array.from(byGroupId.keys()).map((groupId) => {
      const rows = byGroupId.get(groupId) ?? [];
      const groupName = groupById.get(groupId)?.name ?? "Unnamed group";
      const latest = latestSectionTimestamp(rows);
      return {
        kind: "group" as const,
        groupId,
        groupName,
        rows,
        totalCount: groupTotals?.[groupId] ?? rows.length,
        latestMs: latest.ms,
        latestTimestampIso: latest.raw,
      };
    }),
  ]
    .filter((section) => (section.kind === "conversation" ? Boolean(section.row.id) : section.rows.length > 0))
    .sort((a, b) => {
      if (b.latestMs !== a.latestMs) return b.latestMs - a.latestMs;
      if (a.kind === "conversation" && b.kind === "conversation") {
        return String(a.row.title || "").localeCompare(String(b.row.title || ""), undefined, {
          sensitivity: "base",
        });
      }
      if (a.kind === "group" && b.kind === "group") {
        return a.groupName.localeCompare(b.groupName, undefined, { sensitivity: "base" });
      }
      return a.kind === "group" ? -1 : 1;
    });
}
