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

  it('lists planned builtin tools including rag_search and filesystem', async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    if (!res.ok) throw new Error(`GET /api/tools failed: ${res.status}`);
    const tools = (await res.json()) as Array<{ name: string }>;
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('rag_search');
    expect(names).toContain('meta');
    expect(names).toContain('filesystem');
    expect(names).toContain('get_current_time');
  });
});
