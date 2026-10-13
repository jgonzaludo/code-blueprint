import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/server.js';

// real browser tests against the real server and the built ui. skipped when the ui isn't built
// or there's no chrome on the machine (we drive the installed one, nothing is downloaded).
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const uiDir = path.join(repo, 'packages/ui/dist');
const outDir = path.join(repo, 'test-results');

let browser: Browser | null = null;
let srv: RunningServer | null = null;
let root = '';

async function launch(): Promise<Browser | null> {
  for (const opts of [{ channel: 'chrome' as const }, { channel: 'msedge' as const }]) {
    try {
      return await chromium.launch({ ...opts, headless: true });
    } catch {
      // try the next one
    }
  }
  return null;
}

const ready = fs.existsSync(path.join(uiDir, 'index.html'));

beforeAll(async () => {
  if (!ready) return;
  browser = await launch();
  // on CI a missing browser must fail loudly, not skip every test
  if (!browser && process.env.CI) throw new Error('no chrome or edge found for the e2e tests');
  if (!browser) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2e-'));
  fs.cpSync(path.join(repo, 'examples/refund-demo/before'), root, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  // the feature lands uncommitted, so the map has something to show
  fs.cpSync(path.join(repo, 'examples/refund-demo/after'), root, { recursive: true });
  srv = await startServer({ root, port: 0, baseline: 'HEAD', includeTests: false, uiDir, watch: true });
  fs.mkdirSync(outDir, { recursive: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await srv?.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

const run = ready ? describe : describe.skip;
run('map page in a real browser', () => {
  async function open(width = 1280, height = 800, scheme: 'light' | 'dark' = 'light') {
    if (!browser || !srv) return null;
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    await page.goto(srv.url);
    await page.waitForSelector('.bp-blk');
    return { ctx, page, errors };
  }

  it('loads with no console errors and shows the whole refund diff', async () => {
    const s = await open();
    if (!s) return;
    expect(await s.page.locator('.bp-file').count()).toBe(7);
    expect(await s.page.locator('.bp-blk').count()).toBe(24);
    expect(await s.page.locator('#bp-live').textContent()).toBe('watching');
    expect(await s.page.locator('#bp-changes .bp-it').count()).toBe(3);
    expect(s.errors).toEqual([]);
    await s.ctx.close();
  });

  it('moves through the three zoom levels and draws exact lines at the closest', async () => {
    const s = await open();
    if (!s) return;
    const { page } = s;
    expect(await page.locator('#bp-lvl').textContent()).toBe('Project map');
    await page.screenshot({ path: path.join(outDir, 'level-1-map.png') });

    await page.locator('.bp-file[data-f="src/orders.ts"]').dblclick();
    await page.waitForFunction(() => document.getElementById('bp-lvl')?.textContent !== 'Project map');
    await page.waitForTimeout(900);
    const lvl = await page.locator('#bp-lvl').textContent();
    expect(['File', 'Code, line for line']).toContain(lvl);
    await page.waitForSelector('.bp-ln');
    await page.screenshot({ path: path.join(outDir, 'level-2-file.png') });

    // exact source text, and the + / - marks vs HEAD
    const text = await page.locator('.bp-blk[data-id="src/orders.ts::Inventory"]').innerText();
    expect(text).toContain('restock(productId: string, quantity: number): void {');
    expect(await page.locator('.bp-blk[data-id="src/orders.ts::OrderStatus"] .bp-d-p').count()).toBe(1);
    expect(await page.locator('.bp-blk[data-id="src/orders.ts::OrderStatus"] .bp-d-m').count()).toBe(1);

    // zoom all the way in on one block
    await page.locator('.bp-blk[data-id="src/orders.ts::Inventory"] .bp-bh').click();
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await page.waitForTimeout(300);
    expect(await page.locator('#bp-lvl').textContent()).toBe('Code, line for line');
    await page.screenshot({ path: path.join(outDir, 'level-3-code.png') });
    expect(s.errors).toEqual([]);
    await s.ctx.close();
  });

  it('selecting a block fills the inspector with used by and uses', async () => {
    const s = await open();
    if (!s) return;
    await s.page.locator('.bp-blk[data-id="src/refunds.ts::refundOrder"] .bp-bh').click();
    const insp = s.page.locator('#bp-insp');
    await insp.locator('.bp-nm').waitFor();
    expect(await insp.locator('.bp-nm').textContent()).toBe('refundOrder');
    const uses = await insp.innerText();
    expect(uses).toContain('calculateRefundTotal');
    expect(uses).toContain('recordAudit');
    expect(uses.toLowerCase()).toContain('used by');
    await s.ctx.close();
  });

  it('does not scroll sideways at phone width', async () => {
    const s = await open(375, 812);
    if (!s) return;
    const over = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over).toBeLessThanOrEqual(0);
    await s.page.screenshot({ path: path.join(outDir, 'phone.png'), fullPage: true });
    await s.ctx.close();
  });

  it('works in the dark theme', async () => {
    const s = await open(1280, 800, 'dark');
    if (!s) return;
    await s.page.screenshot({ path: path.join(outDir, 'dark-map.png') });
    const bg = await s.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(11, 16, 22)');
    await s.ctx.close();
  });

  it('updates in place when a file is saved', async () => {
    const s = await open();
    if (!s) return;
    const before = await s.page.locator('#bp-meta').textContent();
    fs.writeFileSync(path.join(root, 'src/utils/money.ts'), fs.readFileSync(path.join(root, 'src/utils/money.ts'), 'utf8') + '\nexport function twice(n: number): number {\n  return n * 2;\n}\n');
    await s.page.waitForFunction((b) => document.getElementById('bp-meta')?.textContent !== b, before, { timeout: 8000 });
    expect(await s.page.locator('.bp-blk[data-id="src/utils/money.ts::twice"]').count()).toBe(1);
    await s.ctx.close();
  });
});
