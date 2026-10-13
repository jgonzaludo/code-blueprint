import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/server.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function project(): { root: string; ui: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-srv-'));
  const ui = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-ui-'));
  cleanups.push(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(ui, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.ts'), "import { b } from './b';\nexport function a() {\n  return b();\n}\n");
  fs.writeFileSync(path.join(root, 'src/b.ts'), 'export function b() {\n  return 1;\n}\n');
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(ui, 'index.html'), '<!doctype html><title>bp</title>');
  return { root, ui };
}

async function boot(extra: Partial<Parameters<typeof startServer>[0]> = {}): Promise<{ srv: RunningServer; root: string; base: string }> {
  const { root, ui } = project();
  const srv = await startServer({ root, port: 0, baseline: 'HEAD', includeTests: false, uiDir: ui, watch: true, ...extra });
  cleanups.push(() => srv.close());
  return { srv, root, base: `http://127.0.0.1:${srv.port}` };
}

// fetch can't set Host, so raw http for the rebinding checks
function raw(port: number, p: string, host: string, headers: Record<string, string> = {}, method = 'GET', body?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host, ...headers } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

describe('server security', () => {
  it('binds to 127.0.0.1 and refuses a foreign Host header', async () => {
    const { srv } = await boot();
    const r = await raw(srv.port, `/api/state?t=${srv.token}`, 'evil.example.com');
    expect(r.status).toBe(403);
  });

  it('rejects requests without the token', async () => {
    const { base } = await boot();
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    expect((await fetch(`${base}/`)).status).toBe(401);
    expect((await fetch(`${base}/api/state`, { headers: { 'x-blueprint-token': 'nope' } })).status).toBe(401);
  });

  it('trades the url token for a cookie on first load', async () => {
    const { srv, base } = await boot();
    const r = await fetch(`${base}/?t=${srv.token}`);
    expect(r.status).toBe(200);
    const c = r.headers.get('set-cookie') ?? '';
    expect(c).toContain('bp_t=');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
    const cookie = c.split(';')[0] as string;
    expect((await fetch(`${base}/api/state`, { headers: { cookie } })).status).toBe(200);
  });

  it('rejects cross-origin posts', async () => {
    const { srv } = await boot();
    const r = await raw(srv.port, '/api/open', `127.0.0.1:${srv.port}`, { 'x-blueprint-token': srv.token, origin: 'https://evil.example.com', 'content-type': 'application/json' }, 'POST', '{"file":"src/a.ts"}');
    expect(r.status).toBe(403);
  });

  it('never serves files outside the ui dir', async () => {
    const { srv } = await boot();
    const r = await raw(srv.port, `/..%2f..%2fetc%2fpasswd?t=${srv.token}`, `127.0.0.1:${srv.port}`);
    expect(r.status).toBe(404);
  });
});

describe('server api', () => {
  it('serves the graph and a layout for every file', async () => {
    const { srv, base } = await boot();
    const s = (await (await fetch(`${base}/api/state?t=${srv.token}`)).json()) as {
      rev: number;
      graph: { fstat: Record<string, string>; edges: unknown[] };
      positions: Record<string, { x: number; y: number }>;
    };
    expect(s.rev).toBe(1);
    expect(Object.keys(s.graph.fstat).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(Object.keys(s.positions).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(s.graph.edges).toHaveLength(1);
  });

  it('reports status', async () => {
    const { srv, base } = await boot();
    const s = (await (await fetch(`${base}/api/status?t=${srv.token}`)).json()) as { pid: number; files: number };
    expect(s.pid).toBe(process.pid);
    expect(s.files).toBe(2);
  });

  it('writes and removes .blueprint/server.json', async () => {
    const { srv, root } = await boot();
    const f = path.join(root, '.blueprint', 'server.json');
    expect(JSON.parse(fs.readFileSync(f, 'utf8')).port).toBe(srv.port);
    await srv.close();
    expect(fs.existsSync(f)).toBe(false);
  });

  it('keeps positions of existing files when a new one shows up', async () => {
    const { srv, root, base } = await boot();
    const get = async () => (await (await fetch(`${base}/api/state?t=${srv.token}`)).json()) as { positions: Record<string, { x: number; y: number }> };
    const before = (await get()).positions;
    fs.writeFileSync(path.join(root, 'src/c.ts'), 'export function c() {\n  return 3;\n}\n');
    await srv.refresh();
    const after = (await get()).positions;
    expect(after['src/a.ts']).toEqual(before['src/a.ts']);
    expect(after['src/b.ts']).toEqual(before['src/b.ts']);
    expect(after['src/c.ts']).toBeDefined();
  });

  it('opens the editor for a file in the project and refuses paths outside it', async () => {
    const calls: Array<[string, number]> = [];
    const { srv, root, base } = await boot({ openEditor: async (abs, line) => (calls.push([abs, line]), true) });
    const post = (b: unknown) =>
      fetch(`${base}/api/open`, { method: 'POST', headers: { 'x-blueprint-token': srv.token, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    expect((await post({ file: 'src/a.ts', line: 3 })).status).toBe(200);
    expect(calls).toEqual([[path.join(root, 'src/a.ts'), 3]]);
    expect((await post({ file: '../../etc/passwd' })).status).toBe(400);
    expect((await post({ file: 'src/missing.ts' })).status).toBe(404);
  });
});

describe('live updates', () => {
  it('bumps the rev and pushes it over sse when a file is saved', async () => {
    const { srv, root, base } = await boot();
    const events: number[] = [];
    const ac = new AbortController();
    const res = await fetch(`${base}/api/events?t=${srv.token}`, { signal: ac.signal });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    const pump = (async () => {
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value);
          for (const m of buf.matchAll(/data: (\{.*\})/g)) events.push((JSON.parse(m[1] as string) as { rev: number }).rev);
          buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
        }
      } catch {
        // aborted
      }
    })();
    fs.writeFileSync(path.join(root, 'src/b.ts'), 'export function b() {\n  return 2;\n}\n');
    const t0 = Date.now();
    while (srv.rev() < 2 && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 25));
    expect(srv.rev()).toBe(2);
    // the save to rev bump is the "under about 300 ms" criterion for the live map
    expect(Date.now() - t0).toBeLessThan(1500);
    await new Promise((r) => setTimeout(r, 100));
    ac.abort();
    await pump;
    expect(events).toContain(2);
  });
});
