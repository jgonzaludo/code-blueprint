// boots the built cli against the orders demo and pokes the api. run after `pnpm -r build`.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';

const root = path.resolve('examples/orders-demo');
const cli = path.resolve('packages/cli/dist/cli.js');
const p = spawn(process.execPath, [cli, 'watch', '--root', root, '--no-open', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });

let out = '';
p.stdout.on('data', (d) => (out += d));
p.stderr.on('data', (d) => (out += d));

const url = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no url after 20s:\n${out}`)), 20_000);
  const iv = setInterval(() => {
    const m = /(http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/.exec(out);
    if (m) {
      clearTimeout(t);
      clearInterval(iv);
      resolve(m[1]);
    }
  }, 50);
});

try {
  const u = new URL(url);
  const base = u.origin;
  const token = u.searchParams.get('t');
  const headers = { 'x-blueprint-token': token };

  assert.equal((await fetch(`${base}/api/state`)).status, 401, 'api must need the token');
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Blueprint<\/title>/);
  const js = await fetch(`${base}/app.js`, { headers });
  assert.equal(js.status, 200);

  const s = await (await fetch(`${base}/api/state`, { headers })).json();
  assert.equal(Object.keys(s.graph.fstat).length, 3);
  assert.ok(Object.keys(s.positions).length === 3);
  assert.ok(s.graph.edges.length > 0);
  console.log('smoke ok:', Object.keys(s.graph.fstat).length, 'files,', s.graph.edges.length, 'edges');
} finally {
  p.kill('SIGINT');
}
