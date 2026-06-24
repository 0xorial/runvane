import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { AppSettingsRepo } from '../db/repositories/app-settings.repo.js';
import type { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { ToolEnvironmentsService } from './tool-environments.service.js';
import { ToolHostService } from './tool-host.service.js';

const HOST_ENTRY = process.env.RUNVANE_TOOLHOST_HOST_ENTRY || path.resolve(process.cwd(), '../toolhost/src/host/main.ts');
const suite = existsSync(HOST_ENTRY) ? describe : describe.skip;

function fakeSettings(): AppSettingsRepo {
  const store = new Map<string, unknown>();
  return {
    getJson: async (key: string) => (store.has(key) ? store.get(key) : null),
    setJson: async (key: string, value: unknown) => void store.set(key, value),
  } as unknown as AppSettingsRepo;
}

function fakeConversations(envById: Record<string, string | null>): ConversationsRepo {
  return { getToolEnvironmentId: async (id: string) => envById[id] ?? null } as unknown as ConversationsRepo;
}

suite('ToolHostService routing by conversation environment', () => {
  jest.setTimeout(15000);
  let svc: ToolHostService;

  beforeAll(async () => {
    svc = new ToolHostService(
      new ToolRegistry([]),
      fakeConversations({ 'c-local': 'local', 'c-none': 'none' }),
      new ToolEnvironmentsService(fakeSettings()),
    );
    await svc.onModuleInit();
  });

  afterAll(async () => {
    await svc.onModuleDestroy();
  });

  it('routes a local-env conversation to the local host', async () => {
    const result = await svc.invokeForConversation('c-local', 'exec', { command: 'echo routed-local' }, {});
    expect(result.ok).toBe(true);
    expect((result.output as { stdout: string }).stdout).toMatch(/routed-local/);
  });

  it('reports none as kind "none" and blocks invocation', async () => {
    expect(await svc.environmentKindForConversation('c-none')).toBe('none');
    const result = await svc.invokeForConversation('c-none', 'exec', { command: 'echo nope' }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/disabled/);
  });

  it('defaults an unknown conversation to the local environment', async () => {
    expect(await svc.environmentKindForConversation('c-missing')).toBe('local');
  });
});
