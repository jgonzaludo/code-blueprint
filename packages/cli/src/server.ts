import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Graph } from '@blueprint/core';
import { headSha } from './git.js';
import { GraphBuilder } from './graph.js';
import { ensureStateDir } from './layout.js';
import { computeState, type MapState } from './state.js';

export interface ServerOptions {
  root: string;
  port: number; // 0 picks a free one. otherwise the next free port after this one.
  baseline: 'HEAD' | 'disk';
  includeTests: boolean;
  uiDir: string;
  relayout?: boolean;
  watch?: boolean;
  log?: (line: string) => void;
}

export interface RunningServer {
  port: number;
  token: string;
  url: string; // with the token, what you open in a browser
  rev: () => number;
  refresh: () => Promise<void>;
  relayout: () => Promise<void>;
  close: () => Promise<void>;
}

type State = MapState;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const IGNORED = /(^|[\\/])(node_modules|\.git|dist|build|\.next|coverage)([\\/]|$)/;
const WATCHED = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$|(^|[\\/])tsconfig\.json$/;

export const serverFile = (root: string) => path.join(root, '.blueprint', 'server.json');

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const root = path.resolve(opts.root);
  const log = opts.log ?? (() => {});
  const token = crypto.randomBytes(24).toString('base64url');
  const builder = new GraphBuilder({ root, baseline: opts.baseline, includeTests: opts.includeTests });
  const clients = new Set<http.ServerResponse>();
  let state: State | null = null;
  let lastSig = '';
  let building: Promise<void> | null = null;
  let again = false;
  let wantRelayout = !!opts.relayout;
  let boundPort = 0;

  const sigOf = (g: Graph) => JSON.stringify({ ...g, meta: undefined });

  async function rebuild(): Promise<void> {
    const t0 = performance.now();
    const next = await computeState(builder, { root, includeTests: opts.includeTests, relayout: wantRelayout });
    wantRelayout = false;
    const sig = JSON.stringify({ g: sigOf(next.graph), plans: next.plans, plan: next.plan });
    if (sig === lastSig && state) return;
    const changedBlocks = Object.values(next.graph.blocks).filter((b) => b.status !== 'same').length;
    lastSig = sig;
    state = { rev: (state?.rev ?? 0) + 1, ...next };
    log(`blueprint  parsed ${next.graph.meta?.files ?? 0} files in ${Math.round(performance.now() - t0)} ms  ${changedBlocks} blocks changed`);
    for (const c of clients) c.write(`event: rev\ndata: ${JSON.stringify({ rev: state.rev })}\n\n`);
  }

  // one build at a time, and a save that lands mid-build queues exactly one more
  function refresh(): Promise<void> {
    if (building) {
      again = true;
      return building;
    }
    building = rebuild()
      .catch((e: unknown) => log(`blueprint  parse failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(async () => {
        building = null;
        if (again) {
          again = false;
          await refresh();
        }
      });
    return building;
  }

  const hostOk = (h: string | undefined) => !!h && (h === `127.0.0.1:${boundPort}` || h === `localhost:${boundPort}`);

  function tokenOf(req: http.IncomingMessage, url: URL): string | null {
    const hdr = req.headers['x-blueprint-token'];
    if (typeof hdr === 'string') return hdr;
    const q = url.searchParams.get('t');
    if (q) return q;
    const m = /(?:^|;\s*)bp_t=([^;]+)/.exec(req.headers.cookie ?? '');
    return m ? decodeURIComponent(m[1] as string) : null;
  }

  const authed = (t: string | null) => {
    if (!t) return false;
    const a = Buffer.from(t);
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  const send = (res: http.ServerResponse, code: number, body: string | Buffer, type = 'text/plain; charset=utf-8', extra: http.OutgoingHttpHeaders = {}) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
    res.end(body);
  };
  const json = (res: http.ServerResponse, code: number, v: unknown) => send(res, code, JSON.stringify(v), MIME['.json']);

  const server = http.createServer((req, res) => {
    void (async () => {
      // dns rebinding: a page on another origin can point its own hostname at 127.0.0.1,
      // but it can't make the Host header say localhost:PORT
      if (!hostOk(req.headers.host)) return send(res, 403, 'forbidden host');
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${boundPort}`);
      const t = tokenOf(req, url);
      if (!authed(t)) {
        return send(res, 401, 'open the url blueprint printed, it carries a token\n');
      }
      // the window is read only. anything that changes state goes through the cli, from chat or a terminal.
      if (req.method !== 'GET') return json(res, 405, { error: 'read only' });
      // first visit with ?t= swaps the token for a cookie, so the api and sse need no query string
      const cookie = { 'set-cookie': `bp_t=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/` };

      const p = url.pathname;
      if (req.method === 'GET' && p === '/api/state') {
        if (!state) await refresh();
        // the picker asks for a specific plan. the default (newest) is the cached state.
        const want = url.searchParams.get('plan');
        if (want && state && state.plan?.id !== want && state.plans.some((x) => x.id === want)) {
          const other = await computeState(builder, { root, includeTests: opts.includeTests, planId: want, writeCache: false });
          return json(res, 200, { rev: state.rev, ...other });
        }
        return json(res, 200, state);
      }
      if (req.method === 'GET' && p === '/api/status') {
        return json(res, 200, {
          pid: process.pid,
          root,
          port: boundPort,
          rev: state?.rev ?? 0,
          baseline: builder.baselineLabel,
          files: state ? Object.keys(state.graph.fstat).length : 0,
          typeErrors: state?.graph.meta?.typeErrors ?? 0,
        });
      }
      if (req.method === 'GET' && p === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`retry: 1000\nevent: rev\ndata: ${JSON.stringify({ rev: state?.rev ?? 0 })}\n\n`);
        clients.add(res);
        const beat = setInterval(() => res.write(': ping\n\n'), 20_000);
        req.on('close', () => {
          clearInterval(beat);
          clients.delete(res);
        });
        return;
      }
      if (req.method === 'GET') {
        // static ui. resolve inside uiDir only.
        const rel = p === '/' ? 'index.html' : p.slice(1);
        const abs = path.resolve(opts.uiDir, rel);
        if (!abs.startsWith(path.resolve(opts.uiDir) + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          return send(res, 404, 'not found');
        }
        return send(res, 200, fs.readFileSync(abs), MIME[path.extname(abs)] ?? 'application/octet-stream', cookie);
      }
      return send(res, 404, 'not found');
    })().catch((e: unknown) => {
      if (!res.headersSent) send(res, 500, e instanceof Error ? e.message : 'error');
    });
  });

  // port: first free one at or after the asked one
  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const onErr = (e: NodeJS.ErrnoException) => {
        server.off('listening', onOk);
        if (e.code === 'EADDRINUSE' && port !== 0 && port < opts.port + 20) resolve(listen(port + 1));
        else reject(e);
      };
      const onOk = () => {
        server.off('error', onErr);
        resolve();
      };
      server.once('error', onErr);
      server.once('listening', onOk);
      server.listen(port, '127.0.0.1');
    });
  await listen(opts.port);
  boundPort = (server.address() as { port: number }).port;

  await refresh();

  ensureStateDir(root);
  fs.writeFileSync(serverFile(root), JSON.stringify({ pid: process.pid, port: boundPort, token, root, startedAt: new Date().toISOString() }), { mode: 0o600 });

  // watcher: native recursive fs.watch, debounced
  const closers: Array<() => void> = [];
  if (opts.watch !== false) {
    let timer: NodeJS.Timeout | null = null;
    const poke = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 150);
    };
    try {
      const w = fs.watch(root, { recursive: true }, (_ev, name) => {
        if (!name) return poke();
        const n = String(name).split('\\').join('/');
        // our own state dir is ignored, except plans, which agents write while we're watching
        const inPlans = n.startsWith('.blueprint/plans/');
        if (n.startsWith('.blueprint/') && !inPlans) return;
        if (inPlans || (!IGNORED.test(n) && WATCHED.test(n))) poke();
      });
      w.on('error', () => {});
      closers.push(() => w.close());
    } catch (e) {
      log(`blueprint  can't watch files here (${e instanceof Error ? e.message : String(e)}), edits won't live-update`);
    }
    // a commit moves the baseline without touching any source file
    if (opts.baseline === 'HEAD') {
      let last = headSha(root);
      const iv = setInterval(() => {
        const s = headSha(root);
        if (s !== last) {
          last = s;
          void refresh();
        }
      }, 2000);
      iv.unref();
      closers.push(() => clearInterval(iv));
    }
    closers.push(() => timer && clearTimeout(timer));
  }

  return {
    port: boundPort,
    token,
    url: `http://127.0.0.1:${boundPort}/?t=${token}`,
    rev: () => state?.rev ?? 0,
    refresh,
    relayout: async () => {
      wantRelayout = true;
      lastSig = '';
      await refresh();
    },
    close: async () => {
      for (const c of closers) c();
      for (const c of clients) c.end();
      try {
        fs.rmSync(serverFile(root), { force: true });
      } catch {
        // already gone
      }
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
