import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { buildSnapshotHtml } from '../src/snapshot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const uiBuilt = fs.existsSync(path.join(repo, 'packages/ui/dist/index.html'));
const distUi = path.join(repo, 'packages/ui/dist');
// snapshot reads the built ui bundle, so these need the ui package built
const ready = uiBuilt;
if (!ready && process.env.CI) throw new Error('packages/ui is not built, run pnpm -r build before the tests');

let root = '';
let browser: Browser | null = null;
const outDir = path.join(repo, 'test-results');

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-snap-'));
  fs.cpSync(path.join(repo, 'examples/refund-demo/before'), root, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const { baselineOf, parseTree } = await import('@blueprint/core');
  const { addClaim, addDraft, createPlan } = await import('../src/plans.js');
  createPlan(root, 'refund-support', 'refund support', baselineOf(parseTree(root, { diagnostics: false })));
  for (const f of ['src/refunds.ts', 'src/api/refundHandler.ts', 'src/orders.ts']) {
    addDraft(root, 'refund-support', f, fs.readFileSync(path.join(repo, 'examples/refund-demo/after', f), 'utf8'));
  }
  addClaim(root, 'refund-support', { from: 'src/api/refundHandler.ts::refundHandler', to: 'src/audit/log.ts::recordAudit' });
  if (ready) {
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true });
    } catch {
      if (process.env.CI) throw new Error('no chrome for the snapshot test');
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

async function bp(args: string[]) {
  let out = '';
  let err = '';
  const code = await run(args, { out: (s) => (out += s), err: (s) => (err += s), cwd: root });
  return { code, out, err };
}

describe.skipIf(!ready)('blueprint snapshot', () => {
  it('writes one html file with the data, css, js and fonts inside', async () => {
    const out = path.join(root, 'map.html');
    const r = await bp(['snapshot', '--out', out]);
    expect(r.code).toBe(0);
    const html = fs.readFileSync(out, 'utf8');
    expect(html).toContain('id="bp-data"');
    expect(html).toContain('data:font/woff2;base64,');
    // nothing is fetched from anywhere
    expect(html).not.toMatch(/(src|href)="\//);
    // the only urls are svg xml namespaces, which are identifiers and never fetched
    expect(html.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
    expect(html.indexOf('id="bp-data"')).toBeLessThan(html.indexOf('<script>\n'));
    expect(r.out).toContain("plan 'refund-support'");
  });

  it('keeps only the plan and one hop by default, everything with --all', async () => {
    const small = path.join(root, 'small.html');
    const all = path.join(root, 'all.html');
    await bp(['snapshot', '--out', small]);
    await bp(['snapshot', '--out', all, '--all']);
    const data = (f: string) => {
      const m = /<script type="application\/json" id="bp-data">(.*?)<\/script>/s.exec(fs.readFileSync(f, 'utf8'));
      return JSON.parse(m?.[1] ?? '{}') as { graph: { fstat: Record<string, string> } };
    };
    const a = Object.keys(data(small).graph.fstat).length;
    const b = Object.keys(data(all).graph.fstat).length;
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(b);
  });

  it('survives source text that would break a script tag', () => {
    const html = buildSnapshotHtml(
      {
        rev: 1,
        positions: {},
        plans: [],
        plan: null,
        graph: {
          blocks: { 'a.ts::x': { id: 'a.ts::x', file: 'a.ts', kind: 'const', name: 'x', status: 'same', members: [], lines: [{ t: 'const s = "</script><b>  ";', d: ' ', o: 1, n: 1 }] } },
          edges: [], fedges: [], fstat: { 'a.ts': 'same' }, ftext: {},
        },
      },
      distUi,
    );
    const body = /<script type="application\/json" id="bp-data">(.*?)<\/script>/s.exec(html)?.[1] ?? '';
    expect(body).not.toContain('</script');
    expect(body).not.toContain(' ');
    expect(JSON.parse(body).graph.blocks['a.ts::x'].lines[0].t).toBe('const s = "</script><b>  ";');
  });

  it('opens from file:// with no network and no errors, and the modes work', async () => {
    if (!browser) return;
    const out = path.join(root, 'open.html');
    await bp(['snapshot', '--out', out]);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(`file://${out}`);
    await page.waitForSelector('.bp-blk');

    expect(await page.locator('#bp-live').textContent()).toMatch(/^snapshot/);
    expect(await page.locator('#bp-relayout').isHidden()).toBe(true);
    expect(await page.locator('#bp-modes button.on').textContent()).toBe("Claude's plan");
    expect(await page.locator('.bp-band').textContent()).toBe('New files, above the map');
    await page.locator('#bp-modes button[data-m="applied"]').click();
    expect(await page.locator('#bp-changes').innerText()).toContain('proposed arrows confirmed');
    await page.screenshot({ path: path.join(outDir, 'snapshot.png') });

    // every request is the file itself or an inline data uri, so it works with no network
    expect(requests.filter((u) => !u.startsWith('file://') && !u.startsWith('data:'))).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('refuses an unknown plan id', async () => {
    const r = await bp(['snapshot', '--plan', 'nope', '--out', path.join(root, 'x.html')]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no plan 'nope'");
  });
});
