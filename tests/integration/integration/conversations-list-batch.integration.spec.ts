import { retainSharedTestApp } from '../support/shared-app';
import { createConversation, getConversation } from '../support/http';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

type ListRow = {
  id: string;
  groupId: string | null;
  groupPinned: boolean;
  defaultViewLeafEntryId: string | null;
  defaultViewLeafAnchorId: string | null;
  toolEnvironmentId: string | null;
  forkedFromConversationId: string | null;
  tokenUsageByModel: unknown[];
};

type ListResponse = {
  conversations: ListRow[];
  groups: Array<{ id: string; name: string }>;
};

async function listConversations(baseUrl: string): Promise<ListResponse> {
  const res = await fetch(`${baseUrl}/api/conversations`);
  if (!res.ok) throw new Error(`GET /api/conversations failed: ${res.status}`);
  return (await res.json()) as ListResponse;
}

async function moveToNewGroup(baseUrl: string, conversationId: string, groupName: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newGroupName: groupName }),
  });
  if (!res.ok) throw new Error(`PUT /api/conversations move failed: ${res.status}`);
}

// The list endpoint maps every row through ConversationsService.toApiRowsBatch,
// which fires the four bulk repo queries (token usage, fork links, group pin,
// tool env) in one shot each. Hitting the endpoint at all therefore exercises
// all four raw-SQL IN-clause queries against SQLite; the assertions below pin
// down the field mapping and the deliberate "list rows don't resolve the leaf".
describeIntegration('conversations list batch mapping (integration)', () => {
  let baseUrl: string;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
  }, 30_000);

  it('maps batched fields and skips the per-row leaf walk', async () => {
    const groupName = `batch-grp-${Date.now()}`;
    const grouped = await createConversation(baseUrl);
    const plain = await createConversation(baseUrl);

    // A manual move both assigns the group and pins it against the categorizer.
    await moveToNewGroup(baseUrl, grouped, groupName);

    const list = await listConversations(baseUrl);
    const groupedRow = list.conversations.find((row) => row.id === grouped);
    const plainRow = list.conversations.find((row) => row.id === plain);

    expect(groupedRow).toBeDefined();
    expect(plainRow).toBeDefined();
    expect(list.groups.some((group) => group.name === groupName)).toBe(true);

    // getGroupPinnedByIds maps pins per id: the moved chat is pinned, the other isn't.
    expect(groupedRow!.groupPinned).toBe(true);
    expect(typeof groupedRow!.groupId).toBe('string');
    expect(groupedRow!.groupId).toBeTruthy();
    expect(plainRow!.groupPinned).toBe(false);

    // No messages yet -> tokenUsageByModelByIds yields an empty aggregate.
    expect(groupedRow!.tokenUsageByModel).toEqual([]);
    expect(plainRow!.tokenUsageByModel).toEqual([]);

    // Bulk fork / tool-env lookups resolve to null for plain conversations.
    expect(groupedRow!.forkedFromConversationId).toBeNull();
    expect(plainRow!.toolEnvironmentId).toBeNull();

    // The list path intentionally does NOT walk the branch tree, so the resolved
    // leaf is null here; the stored anchor is also null with no messages.
    expect(groupedRow!.defaultViewLeafEntryId).toBeNull();
    expect(plainRow!.defaultViewLeafEntryId).toBeNull();

    // The single-row GET path (toApiRow) is unchanged and still returns the row.
    const single = await getConversation(baseUrl, grouped);
    expect(single.id).toBe(grouped);
  }, 30_000);
});
