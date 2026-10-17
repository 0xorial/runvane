import type { NextFunction, Request, Response } from 'express';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serveFrontend, spaFallback } from './bootstrap.js';

// No sockets here on purpose: the seat this runs on refuses loopback
// connections, and the behaviour under test is the routing decision, not
// express.static. The deployed shape is verified on terra (docs/terra-deploy.md).

function run(middleware: ReturnType<typeof spaFallback>, req: { method: string; path: string; accept?: string }) {
  let sent: string | null = null;
  let passed = false;
  middleware(
    { method: req.method, path: req.path, headers: { accept: req.accept } } as unknown as Request,
    { sendFile: (file: string) => (sent = file) } as unknown as Response,
    (() => (passed = true)) as NextFunction,
  );
  return { sent, passed };
}

describe('spaFallback', () => {
  const index = '/srv/dist/index.html';
  const mw = spaFallback(index);

  it('sends index.html for HTML navigations the backend does not own', () => {
    expect(run(mw, { method: 'GET', path: '/', accept: 'text/html,*/*' })).toEqual({ sent: index, passed: false });
    expect(run(mw, { method: 'GET', path: '/chat/abc', accept: 'text/html' })).toEqual({ sent: index, passed: false });
    expect(run(mw, { method: 'HEAD', path: '/settings', accept: 'text/html' })).toEqual({ sent: index, passed: false });
  });

  it('passes backend routes through, including unknown ones under the prefixes', () => {
    for (const p of ['/api', '/api/conversations', '/api/nope', '/health', '/test/stub-llm']) {
      expect(run(mw, { method: 'GET', path: p, accept: 'text/html' })).toEqual({ sent: null, passed: true });
    }
    expect(run(mw, { method: 'GET', path: '/apiary', accept: 'text/html' })).toEqual({ sent: index, passed: false });
  });

  it('passes non-HTML requests and mutations through', () => {
    expect(run(mw, { method: 'GET', path: '/data.json', accept: 'application/json' })).toEqual({
      sent: null,
      passed: true,
    });
    expect(run(mw, { method: 'GET', path: '/assets/app.js' })).toEqual({ sent: null, passed: true });
    expect(run(mw, { method: 'POST', path: '/', accept: 'text/html' })).toEqual({ sent: null, passed: true });
  });
});

describe('serveFrontend', () => {
  it('mounts static assets without directory index and the SPA fallback behind them', () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'runvane-dist-'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
    const calls: string[] = [];
    const app = {
      useStaticAssets: (root: string, opts: { index?: boolean | string }) => {
        calls.push(`static:${root}:${String(opts.index)}`);
      },
      use: () => {
        calls.push('use');
      },
    };
    try {
      serveFrontend(app as never, dist);
      expect(calls).toEqual([`static:${path.resolve(dist)}:false`, 'use']);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('does nothing without a dist dir and refuses one without index.html', () => {
    const calls: string[] = [];
    const app = { useStaticAssets: () => calls.push('static'), use: () => calls.push('use') };
    serveFrontend(app as never, null);
    expect(calls).toEqual([]);
    const empty = mkdtempSync(path.join(tmpdir(), 'runvane-empty-'));
    try {
      expect(() => serveFrontend(app as never, empty)).toThrow(/no index.html/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
