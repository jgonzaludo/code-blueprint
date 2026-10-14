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
    // the window shows the change on the map itself: two new files and one modified
    expect(await s.page.locator('.bp-file.bp-s-new').count()).toBe(2);
    expect(await s.page.locator('.bp-file.bp-s-mod').count()).toBe(1);
    expect(s.errors).toEqual([]);
    await s.ctx.close();
  });

  it('moves through the three zoom levels and draws exact lines at the closest', async () => {
    const s = await open();
    if (!s) return;
    const { page } = s;
    expect(await page.locator('#bp-lvl').textContent()).toBe('Project map');
    await page.screenshot({ path: path.join(outDir, 'level-1-map.png') });

    await page.locator('.bp-file[data-f="src/orders.ts"]').dblclick({ position: { x: 24, y: 14 } });
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

  it('lights up only the arrows of the block you point at', async () => {
    const s = await open();
    if (!s) return;
    const { page } = s;
    // fail on the step that is stuck, not on the whole test
    page.setDefaultTimeout(10_000);
    // arrows are under the blocks, never over code
    const z = await page.evaluate(() => getComputedStyle(document.getElementById('bp-bsvg') as Element).zIndex);
    expect(z).toBe('0');
    await page.locator('.bp-file[data-f="src/orders.ts"]').dblclick({ position: { x: 24, y: 14 } });
    await page.waitForFunction(() => document.getElementById('bp-lvl')?.textContent !== 'Project map');
    // block arrows are built once you are at code zoom
    await page.waitForSelector('#bp-bsvg .bp-ed', { state: 'attached' });
    expect(await page.locator('#bp-bsvg .bp-ed.bp-hot').count()).toBe(0);
    await page.locator('.bp-blk[data-id="src/orders.ts::processOrder"] .bp-bh').hover();
    await page.waitForSelector('#bp-bsvg .bp-ed.bp-hot', { state: 'attached' });
    const hot = await page.locator('#bp-bsvg .bp-ed.bp-hot').count();
    const dim = await page.locator('#bp-bsvg .bp-ed.bp-dim').count();
    expect(hot).toBeGreaterThan(0);
    expect(dim).toBeGreaterThan(0);
    // every lit arrow touches the block under the pointer
    const all = await page.locator('#bp-bsvg .bp-ed.bp-hot').evaluateAll((els) => els.map((e) => [e.getAttribute('data-from'), e.getAttribute('data-to')]));
    for (const [f, t] of all) expect([f, t]).toContain('src/orders.ts::processOrder');
    await s.ctx.close();
  });

  it('selecting a block fills the inspector with used by and uses', async () => {
    const s = await open();
    if (!s) return;
    await s.page.locator('.bp-blk[data-id="src/refunds.ts::refundOrder"] .bp-bh').click();
    const insp = s.page.locator('#bp-insp');
    await insp.locator('.bp-nm').waitFor();
    expect(await insp.isVisible()).toBe(true);
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
    // the app's chat background, sampled from a real screenshot: #151515
    expect(bg).toBe('rgb(21, 21, 21)');
    await s.ctx.close();
  });

  it('matches the app in light too', async () => {
    const s = await open(1280, 800, 'light');
    if (!s) return;
    // the app's light chat background, sampled from a real screenshot
    expect(await s.page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(252, 252, 252)');
    await s.page.screenshot({ path: path.join(outDir, 'light-map.png') });
    await s.ctx.close();
  });

  it('updates in place when a file is saved', async () => {
    const s = await open();
    if (!s) return;
    const file = path.join(root, 'src/utils/money.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '\nexport function twice(n: number): number {\n  return n * 2;\n}\n');
    await s.page.waitForSelector('.bp-blk[data-id="src/utils/money.ts::twice"]', { timeout: 15_000 });
    // the new block is marked as new on the map
    expect(await s.page.locator('.bp-blk[data-id="src/utils/money.ts::twice"]').getAttribute('class')).toContain('bp-s-new');
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

  it('shows the review state as text only, there is nothing to click', async () => {
    if (!browser || !srv2) return;
    const { setReview } = await import('../src/plans.js');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(srv2.url);
    await page.waitForSelector('.bp-blk');
    expect(await page.locator('#bp-modes button.on').textContent()).toBe("Claude's plan");
    // the window never has buttons that change anything
    expect(await page.locator('#bp-card button').count()).toBe(0);
    expect(await page.locator('#bp-relayout').count()).toBe(0);

    const wait = { timeout: 30_000 };
    setReview(root2, 'refund-support', 'ready');
    await srv2.refresh();
    await page.waitForFunction(() => document.getElementById('bp-card')?.textContent?.includes('Ready for your review'), null, wait);
    expect(await page.locator('#bp-card').innerText()).toContain('Say go in chat');
    expect(await page.locator('#bp-card button').count()).toBe(0);

    setReview(root2, 'refund-support', 'approved');
    await srv2.refresh();
    await page.waitForFunction(() => document.getElementById('bp-card')?.textContent?.includes('Approved'), null, wait);

    setReview(root2, 'refund-support', 'changes', 'keep orders.ts as is');
    await srv2.refresh();
    await page.waitForFunction(() => document.getElementById('bp-card')?.textContent?.includes('keep orders.ts as is'), null, wait);
    await page.screenshot({ path: path.join(outDir, 'plan-review.png') });

    setReview(root2, 'refund-support', 'drafting');
    await srv2.refresh();
    await ctx.close();
  }, 90_000);

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
    expect(await page.locator('#bp-card').innerText()).toContain('refund support');
    expect(fs.existsSync(path.join(root2, 'src/refunds.ts'))).toBe(false);
    await page.screenshot({ path: path.join(outDir, 'plan-view.png') });

    // before applying, the check has nothing to confirm
    await page.locator('#bp-modes button[data-m="applied"]').click();
    expect(await page.locator('#bp-card').innerText()).toContain('0 of 10 planned arrows confirmed');

    // apply the plan on disk while the page is open
    const { applyPlan } = await import('../src/plans.js');
    applyPlan(root2, 'refund-support');
    await page.waitForFunction(() => document.getElementById('bp-card')?.textContent?.includes('9 of 10 planned arrows confirmed'), null, { timeout: 10_000 });
    const text = await page.locator('#bp-card').innerText();
    expect(text).toContain('not in the code');
    expect(text).toContain('refundHandler to recordAudit');
    await page.screenshot({ path: path.join(outDir, 'applied-check.png') });

    expect(errors).toEqual([]);
    await ctx.close();
  });
});

run('focus on a big project', () => {
  let big = '';
  let srv3: RunningServer | null = null;

  beforeAll(async () => {
    if (!browser) return;
    big = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2e-big-'));
    fs.mkdirSync(path.join(big, 'src'));
    // 70 small files in a chain, so each one has a neighbour
    for (let i = 0; i < 70; i++) {
      const imp = i > 0 ? `import { f${i - 1} } from './f${i - 1}';\n` : '';
      const body = i > 0 ? `return f${i - 1}() + 1;` : 'return 0;';
      fs.writeFileSync(path.join(big, `src/f${i}.ts`), `${imp}export function f${i}(): number {\n  ${body}\n}\n`);
    }
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: big, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    // one uncommitted change in the middle
    fs.writeFileSync(path.join(big, 'src/f30.ts'), fs.readFileSync(path.join(big, 'src/f30.ts'), 'utf8') + '// edited\n');
    srv3 = await startServer({ root: big, port: 0, baseline: 'HEAD', includeTests: false, uiDir, watch: false });
  }, 90_000);

  afterAll(async () => {
    await srv3?.close();
    if (big) fs.rmSync(big, { recursive: true, force: true });
  });

  it('opens focused on the change and one hop, and one click shows everything', async () => {
    if (!browser || !srv3) return;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(srv3.url);
    await page.waitForSelector('.bp-blk');
    // f30 changed, f29 is what it calls, f31 calls it
    expect(await page.locator('.bp-file').count()).toBe(3);
    expect(await page.locator('#bp-scopenote').textContent()).toBe('showing 3 of 70 files');
    await page.locator('#bp-scope button[data-s="all"]').click();
    expect(await page.locator('.bp-file').count()).toBe(70);
    await page.locator('#bp-scope button[data-s="focus"]').click();
    expect(await page.locator('.bp-file').count()).toBe(3);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 90_000);
});

run('planning in plan mode, then the code landing', () => {
  let root4 = '';
  let srv4: RunningServer | null = null;

  beforeAll(async () => {
    if (!browser) return;
    root4 = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2e-sketch-'));
    fs.cpSync(path.join(repo, 'examples/refund-demo/before'), root4, { recursive: true });
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root4, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    srv4 = await startServer({ root: root4, port: 0, baseline: 'HEAD', includeTests: false, uiDir, watch: true });
  }, 60_000);

  afterAll(async () => {
    await srv4?.close();
    if (root4) fs.rmSync(root4, { recursive: true, force: true });
  });

  it('shows sketched blocks at once, turns them solid as code lands, then goes back to plain code', async () => {
    if (!browser || !srv4) return;
    const { baselineOf, parseTree } = await import('@blueprint/core');
    const { addClaim, addSketch, createPlan, setReview } = await import('../src/plans.js');
    // dark, like the app it sits next to
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(srv4.url);
    await page.waitForSelector('.bp-blk');
    // no plan: no plan tabs
    expect(await page.locator('#bp-modes').isVisible()).toBe(false);
    const wait = { timeout: 30_000 };

    // Claude plans: sketches and the calls between them, no code written
    createPlan(root4, 'promos', 'promo codes', baselineOf(parseTree(root4, { diagnostics: false })));
    addSketch(root4, 'promos', 'src/promos.ts::applyPromo', 'function', 'applyPromo(total: number): number');
    addSketch(root4, 'promos', 'src/promos.ts::PromoCode', 'interface', 'interface PromoCode');
    addClaim(root4, 'promos', { from: 'src/promos.ts::applyPromo', to: 'src/utils/money.ts::roundMoney', note: 'round the result' });
    setReview(root4, 'promos', 'ready');
    await srv4.refresh();

    // the blocks appear on their own, dashed, in the plan tab
    await page.waitForSelector('.bp-blk[data-id="src/promos.ts::applyPromo"].bp-pending', wait);
    expect(await page.locator('#bp-modes button.on').textContent()).toBe("Claude's plan");
    expect(await page.locator('.bp-blk.bp-sk').count()).toBe(2);
    expect(await page.locator('#bp-card').innerText()).toContain('0 of 2 blocks written');

    // accepted, then the code is written one block at a time
    setReview(root4, 'promos', 'approved');
    fs.writeFileSync(
      path.join(root4, 'src/promos.ts'),
      "import { roundMoney } from './utils/money';\nexport function applyPromo(total: number): number {\n  return roundMoney(total * 0.9);\n}\n",
    );
    await srv4.refresh();
    await page.waitForSelector('.bp-blk[data-id="src/promos.ts::applyPromo"].bp-landed', wait);
    expect(await page.locator('.bp-blk[data-id="src/promos.ts::PromoCode"]').getAttribute('class')).toContain('bp-pending');
    expect(await page.locator('#bp-card').innerText()).toContain('1 of 2 blocks written');
    await page.screenshot({ path: path.join(outDir, 'plan-progress.png') });

    // the last block lands: nothing is pending, so the plan tabs go away and it is just the code
    fs.appendFileSync(path.join(root4, 'src/promos.ts'), 'export interface PromoCode {\n  code: string;\n}\n');
    await srv4.refresh();
    await page.waitForFunction(() => (document.getElementById('bp-modes') as HTMLElement).hidden, null, wait);
    expect(await page.locator('#bp-card').isVisible()).toBe(false);
    expect(await page.locator('.bp-band').count()).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);
});
