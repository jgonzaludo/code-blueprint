import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { baselineOf, checkPlan, markLanded, parseTree, planGraph, type PlanFile } from '../src/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const before = path.join(repo, 'examples/refund-demo/before');
const after = path.join(repo, 'examples/refund-demo/after');

const listFiles = (dir: string, base = dir): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')],
  );

// the refund plan: three drafted files, plus the one claim the code never makes
const plan: PlanFile = {
  id: 'refund-support',
  title: 'refund support',
  created: '2026-10-13T19:41:00Z',
  files: ['src/refunds.ts', 'src/api/refundHandler.ts', 'src/orders.ts'],
  delete: [],
  claims: [
    {
      from: 'src/api/refundHandler.ts::refundHandler',
      to: 'src/audit/log.ts::recordAudit',
      note: 'audit refund.requested before refunding',
    },
  ],
};

const overlay = new Map<string, string | null>();
for (const f of plan.files) overlay.set(f, fs.readFileSync(path.join(after, f), 'utf8'));

const disk = parseTree(before);
const draft = parseTree(before, { overlay });
const baseline = baselineOf(disk);

describe('planGraph', () => {
  const g = planGraph(disk, draft, plan);

  it('shows the plan as new files and modified blocks, parser derived', () => {
    expect(g.fstat['src/refunds.ts']).toBe('new');
    expect(g.fstat['src/api/refundHandler.ts']).toBe('new');
    expect(g.fstat['src/orders.ts']).toBe('mod');
    expect(g.fstat['src/utils/money.ts']).toBe('same');
    expect(g.blocks['src/orders.ts::Inventory']?.status).toBe('mod');
  });

  it('has 9 proposed arrows from the parser and 1 claim', () => {
    const proposed = g.edges.filter((e) => e.status === 'new' && e.source === 'parser');
    const claims = g.edges.filter((e) => e.source === 'claim');
    expect(proposed).toHaveLength(9);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.from).toBe('src/api/refundHandler.ts::refundHandler');
    expect(g.plan?.claims).toHaveLength(1);
  });
});

describe('checkPlan on the refund demo', () => {
  // the real code, after the feature was written: has every drafted arrow, but not the claimed one
  const applied = parseTree(after);

  it('reproduces 9 of 10 confirmed, with the claimed call not in the code', () => {
    const r = checkPlan(applied, draft, plan, baseline);
    expect(r.summary).toEqual({ confirmed: 9, missing: 1, unplanned: 0, planned: 10 });
    const missing = r.edges.filter((e) => e.check === 'missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      from: 'src/api/refundHandler.ts::refundHandler',
      to: 'src/audit/log.ts::recordAudit',
      source: 'claim',
    });
    expect(r.blocks).toEqual({ missing: [], extra: [] });
  });

  it('flags a drafted arrow that was not written', () => {
    const o = new Map(overlay);
    const handler = (o.get('src/api/refundHandler.ts') as string).replace(/\n.*refundOrder\(.*\n/, '\n  return null as never;\n');
    o.set('src/api/refundHandler.ts', handler);
    const applied2 = parseTree(before, { overlay: o });
    const r = checkPlan(applied2, draft, plan, baseline);
    expect(r.summary.missing).toBeGreaterThanOrEqual(2);
    expect(r.edges.some((e) => e.check === 'missing' && e.to === 'src/refunds.ts::refundOrder')).toBe(true);
  });

  it('flags a call nobody planned', () => {
    const o = new Map(overlay);
    const refunds = (o.get('src/refunds.ts') as string) + '\nexport function sneaky(): number {\n  return roundMoney(1);\n}\n';
    o.set('src/refunds.ts', refunds);
    const applied3 = parseTree(before, { overlay: o });
    const r = checkPlan(applied3, draft, plan, baseline);
    expect(r.edges.filter((e) => e.check === 'unplanned').map((e) => e.from)).toEqual(['src/refunds.ts::sneaky']);
    expect(r.blocks.extra).toEqual(['src/refunds.ts::sneaky']);
  });

  it('reports planned blocks that never got written', () => {
    const o = new Map(overlay);
    o.delete('src/refunds.ts'); // the file was never created
    const applied4 = parseTree(before, { overlay: o });
    const r = checkPlan(applied4, draft, plan, baseline);
    expect(r.blocks.missing).toContain('src/refunds.ts::refundOrder');
  });

  it('before the edit, everything planned is missing', () => {
    const r = checkPlan(disk, draft, plan, baseline);
    expect(r.summary.confirmed).toBe(0);
    expect(r.summary.missing).toBe(10);
  });
});

describe('overlay deletes', () => {
  it('lists a deleted file as removed in the plan graph', () => {
    const o = new Map<string, string | null>([['src/jobs/retry.ts', null]]);
    const d = parseTree(before, { overlay: o });
    const g = planGraph(disk, d, { ...plan, files: [], delete: ['src/jobs/retry.ts'], claims: [] });
    expect(g.fstat['src/jobs/retry.ts']).toBe('del');
    expect(listFiles(before)).toContain('src/jobs/retry.ts');
  });
});

describe('sketches and landing', () => {
  const sketchPlan: PlanFile = {
    id: 'promos',
    title: 'promo codes',
    created: '2026-10-14T00:00:00Z',
    files: [],
    delete: [],
    claims: [{ from: 'src/promos.ts::applyPromo', to: 'src/utils/money.ts::roundMoney', note: 'round the discount' }],
    sketch: [
      { id: 'src/promos.ts::applyPromo', kind: 'function', signature: 'applyPromo(order: Order, code: string): Order' },
      { id: 'src/promos.ts::PromoCode', kind: 'interface', signature: 'interface PromoCode' },
    ],
  };

  it('draws sketched blocks as new, signature-only blocks in a new file', () => {
    const g = planGraph(disk, disk, sketchPlan);
    expect(g.fstat['src/promos.ts']).toBe('new');
    const b = g.blocks['src/promos.ts::applyPromo'];
    expect(b).toMatchObject({ sketch: true, status: 'new', kind: 'function' });
    expect(b?.lines).toEqual([{ t: 'applyPromo(order: Order, code: string): Order', d: '+', o: null, n: null }]);
    // the claim between two blocks that now both exist becomes a dashed arrow
    expect(g.edges.filter((e) => e.source === 'claim')).toHaveLength(1);
  });

  it('marks blocks and arrows landed as the real code appears', () => {
    const g0 = planGraph(disk, disk, sketchPlan);
    const none = markLanded(g0, disk, disk);
    expect(none).toEqual({ blocks: 2, landed: 0 });

    // applyPromo gets written (and calls roundMoney), PromoCode is still missing
    const code = "import { roundMoney } from './utils/money';\nexport function applyPromo(total: number): number {\n  return roundMoney(total * 0.9);\n}\n";
    const half = parseTree(before, { overlay: new Map([['src/promos.ts', code]]) });
    const g1 = planGraph(disk, disk, sketchPlan);
    const prog = markLanded(g1, half, disk);
    expect(prog).toEqual({ blocks: 2, landed: 1 });
    expect(g1.blocks['src/promos.ts::applyPromo']?.landed).toBe(true);
    expect(g1.blocks['src/promos.ts::PromoCode']?.landed).toBe(false);
    expect(g1.edges.find((e) => e.source === 'claim')?.landed).toBe(true);
  });

  it('counts sketches as planned blocks in the check', () => {
    const r = checkPlan(disk, disk, sketchPlan, baselineOf(disk));
    expect(r.blocks.missing).toEqual(['src/promos.ts::PromoCode', 'src/promos.ts::applyPromo']);
    expect(r.summary).toMatchObject({ confirmed: 0, missing: 1 });
  });
});
