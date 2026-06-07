import type { SidebarSection } from "./ConversationSidebarSections";
import type { ConversationRow } from "./types";

export type VirtualSidebarRow =
  | {
      kind: "group-header";
      groupId: string;
      groupName: string;
      rowCount: number;
      latestTimestampIso: string;
      collapsed: boolean;
    }
  | {
      kind: "conversation";
      row: ConversationRow;
      nested: boolean;
    };

const ROW_HEIGHT_CONVERSATION = 34;
const ROW_HEIGHT_GROUP_HEADER = 40;

export function flattenSidebarSections(
  orderedSections: SidebarSection[],
  collapsedGroups: Record<string, boolean>,
): VirtualSidebarRow[] {
  const rows: VirtualSidebarRow[] = [];
  for (const section of orderedSections) {
    if (section.kind === "conversation") {
      rows.push({ kind: "conversation", row: section.row, nested: false });
      continue;
    }
    const collapsed = collapsedGroups[section.groupId] ?? false;
    rows.push({
      kind: "group-header",
      groupId: section.groupId,
      groupName: section.groupName,
      rowCount: section.rows.length,
      latestTimestampIso: section.latestTimestampIso,
      collapsed,
    });
    if (!collapsed) {
      for (const row of section.rows) {
        rows.push({ kind: "conversation", row, nested: true });
      }
    }
  }
  return rows;
}

export function virtualRowHeight(row: VirtualSidebarRow): number {
  return row.kind === "group-header" ? ROW_HEIGHT_GROUP_HEADER : ROW_HEIGHT_CONVERSATION;
}
