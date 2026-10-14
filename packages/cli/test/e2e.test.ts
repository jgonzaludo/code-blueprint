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
// on CI a missing ui build must fail, not quietly skip every browser test
if (!ready && process.env.CI) throw new Error('packages/ui is not built, run pnpm -r build before the tests');

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

run('plan view in a real browser', () => {
  let root2 = '';
  let srv2: RunningServer | null = null;

  beforeAll(async () => {
    if (!browser) return;
    const { baselineOf, parseTree } = await import('@blueprint/core');
    const { addClaim, addDraft, createPlan } = await import('../src/plans.js');
    root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2e-plan-'));
    fs.cpSync(path.join(repo, 'examples/refund-demo/before'), root2, { recursive: true });
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root2, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    createPlan(root2, 'refund-support', 'refund support', baselineOf(parseTree(root2, { diagnostics: false })));
    for (const f of ['src/refunds.ts', 'src/api/refundHandler.ts', 'src/orders.ts']) {
      addDraft(root2, 'refund-support', f, fs.readFileSync(path.join(repo, 'examples/refund-demo/after', f), 'utf8'));
    }
    addClaim(root2, 'refund-support', { from: 'src/api/refundHandler.ts::refundHandler', to: 'src/audit/log.ts::recordAudit', note: 'audit first' });
    srv2 = await startServer({ root: root2, port: 0, baseline: 'HEAD', includeTests: false, uiDir, watch: true });
  }, 60_000);

  afterAll(async () => {
    await srv2?.close();
    if (root2) fs.rmSync(root2, { recursive: true, force: true });
  });

  it('shows the review bar inside the plan view only once Claude marked it ready', async () => {
    if (!browser || !srv2) return;
    const { setReview, readPlan } = await import('../src/plans.js');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(srv2.url);
    await page.waitForSelector('.bp-blk');
    // a plan nobody marked ready looks exactly like before: no review controls
    expect(await page.locator('#bp-approve').count()).toBe(0);
    expect(await page.locator('#bp-modes button.on').textContent()).toBe("Claude's plan");

    setReview(root2, 'refund-support', 'ready');
    await page.waitForSelector('#bp-approve', { timeout: 8000 });
    expect(await page.locator('#bp-changes').innerText()).toContain('Ready for your review');
    await page.locator('#bp-approve').click();
    await page.waitForFunction(() => document.getElementById('bp-changes')?.textContent?.includes('Approved.'), null, { timeout: 8000 });
    expect(readPlan(root2, 'refund-support').plan.review?.state).toBe('approved');

    // and changes with a note
    setReview(root2, 'refund-support', 'ready');
    await page.waitForSelector('#bp-changes-btn', { timeout: 8000 });
    await page.locator('#bp-changes-btn').click();
    await page.locator('#bp-note').fill('keep orders.ts as is');
    await page.locator('#bp-send').click();
    await page.waitForFunction(() => document.getElementById('bp-changes')?.textContent?.includes('Changes requested.'), null, { timeout: 8000 });
    expect(readPlan(root2, 'refund-support').plan.review).toMatchObject({ state: 'changes', note: 'keep orders.ts as is' });
    await page.screenshot({ path: path.join(outDir, 'plan-review.png') });
    // back to drafting so the next test sees the plain plan view
    setReview(root2, 'refund-support', 'drafting');
    await ctx.close();
  });

  it('leads with the plan, then shows 9 of 10 once it is applied', async () => {
    if (!browser || !srv2) return;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(srv2.url);
    await page.waitForSelector('.bp-blk');

    // plan view: switch is visible, new files sit in a band, nothing is on disk yet
    expect(await page.locator('#bp-modes').isVisible()).toBe(true);
    expect(await page.locator('#bp-modes button.on').textContent()).toBe("Claude's plan");
    expect(await page.locator('.bp-band').textContent()).toBe('New files, above the map');
    expect(await page.locator('.bp-file.bp-s-new').count()).toBe(2);
    expect(await page.locator('#bp-changes').innerText()).toContain('refundHandler.ts');
    expect(fs.existsSync(path.join(root2, 'src/refunds.ts'))).toBe(false);
    await page.screenshot({ path: path.join(outDir, 'plan-view.png') });

    // before applying, the check has nothing to confirm
    await page.locator('#bp-modes button[data-m="applied"]').click();
    expect(await page.locator('#bp-changes').innerText()).toContain('0 of 10 proposed arrows confirmed');

    // apply the plan on disk while the page is open
    const { applyPlan } = await import('../src/plans.js');
    applyPlan(root2, 'refund-support');
    await page.waitForFunction(() => document.getElementById('bp-changes')?.textContent?.includes('9 of 10 proposed arrows confirmed'), null, { timeout: 10_000 });
    const text = await page.locator('#bp-changes').innerText();
    expect(text).toContain('Not in the code');
    expect(text).toContain('refundHandler to recordAudit');
    await page.screenshot({ path: path.join(outDir, 'applied-check.png') });

    expect(errors).toEqual([]);
    await ctx.close();
  });
});
