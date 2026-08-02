import { retainSharedTestApp, shutdownSharedTestApp } from '../support/shared-app';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

describeLive('tools catalog (integration)', () => {
  let baseUrl: string;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
  }, 30_000);

  afterAll(async () => {
    await shutdownSharedTestApp();
  });

  it('lists planned builtin tools including knowledge and filesystem', async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    if (!res.ok) throw new Error(`GET /api/tools failed: ${res.status}`);
    const tools = (await res.json()) as Array<{ name: string }>;
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('knowledge');
    expect(names).toContain('api');
    expect(names).toContain('conversations');
    expect(names).toContain('filesystem_index');
    expect(names).toContain('filesystem');
    expect(names).toContain('get_current_time');
  });

  it('registers the split filesystem tools as governed target tools with the right rules', async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    if (!res.ok) throw new Error(`GET /api/tools failed: ${res.status}`);
    const tools = (await res.json()) as Array<{
      name: string;
      location?: string;
      default_policy?: string;
      params_schema?: { properties?: Record<string, unknown> };
      rules_schema?: unknown;
    }>;
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    const read = byName.get('filesystem_read');
    expect(read).toBeTruthy();
    // Attached rules profile ⇒ governed target tool dispatched to the sandbox.
    expect(read!.location).toBe('target');
    expect(read!.default_policy).toBe('custom');
    // The read tool's operations are surfaced to the planner via the schema.
    const readOps = (read!.params_schema?.properties?.operation as { enum?: string[] } | undefined)?.enum ?? [];
    expect(readOps).toEqual(expect.arrayContaining(['read', 'list', 'grep', 'find', 'stat']));
    // Its rules expose read containment but never a writable root.
    const readRules = JSON.stringify(read!.rules_schema);
    expect(readRules).toContain('allowed_roots');
    expect(readRules).not.toContain('writable_roots');

    const write = byName.get('filesystem_write');
    expect(write).toBeTruthy();
    expect(write!.location).toBe('target');
    expect(write!.default_policy).toBe('custom');
    const writeOps = (write!.params_schema?.properties?.operation as { enum?: string[] } | undefined)?.enum ?? [];
    expect(writeOps).toEqual(expect.arrayContaining(['write', 'replace', 'edit', 'mkdir', 'move', 'delete']));
    // Its rules expose the writable-root fail-closed switch and the delete gate.
    const writeRules = JSON.stringify(write!.rules_schema);
    expect(writeRules).toContain('writable_roots');
    expect(writeRules).toContain('allow_delete');
  });
});
