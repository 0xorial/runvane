import type { AppSettingsRepo } from '../db/repositories/app-settings.repo.js';
import { TOOL_SANDBOXES_SETTING_KEY } from '../contracts/tool-sandbox.js';
import { ToolSandboxesService } from './tool-sandboxes.service.js';

function fakeSettings(): AppSettingsRepo {
  const store = new Map<string, unknown>();
  return {
    getJson: async (key: string) => (store.has(key) ? store.get(key) : null),
    setJson: async (key: string, value: unknown) => void store.set(key, value),
  } as unknown as AppSettingsRepo;
}

describe('ToolSandboxesService', () => {
  it('lists the two built-ins by default', async () => {
    const svc = new ToolSandboxesService(fakeSettings());
    const list = await svc.list();
    expect(list.map((e) => e.id)).toEqual(['local', 'none']);
    expect(list.every((e) => e.builtin)).toBe(true);
  });

  it('creates, updates and removes an ssh sandbox', async () => {
    const svc = new ToolSandboxesService(fakeSettings());

    const created = await svc.upsert({ name: 'Box', ssh: { host: 'box.local', user: 'dev' } });
    expect(created.kind).toBe('ssh');
    expect(created.builtin).toBe(false);
    expect((await svc.list()).map((e) => e.id)).toEqual(['local', 'none', created.id]);

    const updated = await svc.upsert({ id: created.id, name: 'Box 2', ssh: { host: 'box2.local' } });
    expect(updated.name).toBe('Box 2');
    expect((await svc.listExternal()).length).toBe(1);

    await svc.remove(created.id);
    expect(await svc.listExternal()).toEqual([]);
  });

  it('rejects built-in ids and unknown updates/deletes', async () => {
    const svc = new ToolSandboxesService(fakeSettings());
    await expect(svc.upsert({ id: 'local', name: 'x', ssh: { host: 'h' } })).rejects.toThrow(/built-in/);
    await expect(svc.upsert({ id: 'ghost', name: 'x', ssh: { host: 'h' } })).rejects.toThrow(/not found/);
    await expect(svc.remove('none')).rejects.toThrow(/built-in/);
    await expect(svc.remove('ghost')).rejects.toThrow(/not found/);
  });

  it('ignores malformed stored entries', async () => {
    const settings = fakeSettings();
    await settings.setJson(TOOL_SANDBOXES_SETTING_KEY, [{ junk: true }, { id: 'local', builtin: true }]);
    const svc = new ToolSandboxesService(settings);
    expect(await svc.listExternal()).toEqual([]);
  });
});
