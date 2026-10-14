import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../src/run.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const demo = path.join(repo, 'examples/refund-demo');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function project(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-plan-'));
  dirs.push(d);
  fs.cpSync(path.join(demo, 'before'), d, { recursive: true });
  return d;
}

async function bp(cwd: string, args: string[], stdin: string | null = null) {
  let out = '';
  let err = '';
  const code = await run(args, { out: (s) => (out += s), err: (s) => (err += s), cwd, stdin: async () => stdin });
  return { code, out, err };
}

const after = (rel: string) => path.join(demo, 'after', rel);

async function draftRefundPlan(d: string) {
  expect((await bp(d, ['plan', 'new', 'refund-support', '--title', 'refund support'])).code).toBe(0);
  for (const f of ['src/refunds.ts', 'src/api/refundHandler.ts', 'src/orders.ts']) {
    const r = await bp(d, ['plan', 'add', 'refund-support', f, '--from', after(f)]);
    expect(r.code).toBe(0);
  }
  const c = await bp(d, [
    'plan', 'claim', 'refund-support',
    'src/api/refundHandler.ts::refundHandler', 'src/audit/log.ts::recordAudit',
    '--note', 'audit refund.requested before refunding',
  ]);
  expect(c.code).toBe(0);
}

describe('plan then check, end to end', () => {
  it('shows the draft as a plan without touching real files', async () => {
    const d = project();
    await draftRefundPlan(d);
    const before = fs.readFileSync(path.join(d, 'src/orders.ts'), 'utf8');

    const r = await bp(d, ['plan', 'show']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('PLAN  refund support   proposed, nothing written yet');
    expect(r.out).toContain('+ src/api/refundHandler.ts  NEW');
    expect(r.out).toMatch(/\+ refundHandler\s+-> loadOrder, refundOrder, recordAudit\? \(claim\)/);
    expect(r.out).toContain('+ src/refunds.ts  NEW');
    expect(r.out).toMatch(/\+ refundOrder\s+-> calculateRefundTotal, roundMoney, restockOrderItems, recordAudit/);
    expect(r.out).toContain('~ src/orders.ts  MODIFIED, 2 blocks');
    expect(r.out).toContain('~ OrderStatus');
    expect(r.out).toContain('used by the new code, unchanged:');
    expect(r.out).toContain('9 arrows come from the draft code (parser facts), 1 is a claim');

    // real files untouched, and no refunds.ts yet
    expect(fs.readFileSync(path.join(d, 'src/orders.ts'), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(d, 'src/refunds.ts'))).toBe(false);
  });

  it('check before applying says everything is missing', async () => {
    const d = project();
    await draftRefundPlan(d);
    const r = await bp(d, ['check', '--json']);
    const j = JSON.parse(r.out);
    expect(j.summary).toEqual({ confirmed: 0, missing: 10, unplanned: 0, planned: 10 });
  });

  it('apply then check reproduces 9 of 10 with the claim not in the code', async () => {
    const d = project();
    await draftRefundPlan(d);
    // no review step needed: plans apply exactly as they did before review existed
    const ap = await bp(d, ['plan', 'apply', 'refund-support']);
    expect(ap.code).toBe(0);
    expect(fs.existsSync(path.join(d, 'src/refunds.ts'))).toBe(true);

    const r = await bp(d, ['check']);
    expect(r.out).toContain('9 of 10 planned arrows confirmed');
    expect(r.out).toContain('[ok] refunds.ts refundOrder -> recordAudit');
    expect(r.out).toMatch(/\[x\]\s+refundHandler\.ts refundHandler -> recordAudit\s+not in the code\s+\(claim\)/);

    const j = JSON.parse((await bp(d, ['check', 'refund-support', '--json'])).out);
    expect(j.summary).toEqual({ confirmed: 9, missing: 1, unplanned: 0, planned: 10 });

    const show = await bp(d, ['plan', 'show']);
    expect(show.out).toContain('applied, the files match the draft');
  });

  it('sends an approved plan back to drafting when it changes', async () => {
    const d = project();
    await draftRefundPlan(d);
    await bp(d, ['plan', 'ready', 'refund-support']);
    await bp(d, ['plan', 'approve', 'refund-support']);
    const st = async () => JSON.parse((await bp(d, ['plan', 'status', 'refund-support', '--json'])).out);
    expect((await st()).state).toBe('approved');
    await bp(d, ['plan', 'add', 'refund-support', 'src/extra.ts'], 'export const x = 1;\n');
    expect((await st()).state).toBe('drafting');
  });

  it('records a request for changes with its note', async () => {
    const d = project();
    await draftRefundPlan(d);
    await bp(d, ['plan', 'ready', 'refund-support']);
    await bp(d, ['plan', 'changes', 'refund-support', '--note', "don't touch orders.ts"]);
    const s = JSON.parse((await bp(d, ['plan', 'status', '--json'])).out);
    expect(s).toMatchObject({ state: 'changes', note: "don't touch orders.ts" });
  });

  it('once marked ready, apply waits for approval, or --yes when the user said go in chat', async () => {
    const d = project();
    await draftRefundPlan(d);
    expect((await bp(d, ['plan', 'approve', 'refund-support'])).code).toBe(1); // still drafting
    expect((await bp(d, ['plan', 'ready', 'refund-support'])).code).toBe(0);
    const refused = await bp(d, ['plan', 'apply', 'refund-support']);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('waiting for review');
    expect(fs.existsSync(path.join(d, 'src/refunds.ts'))).toBe(false);
    expect((await bp(d, ['plan', 'apply', 'refund-support', '--yes'])).code).toBe(0);
    expect(fs.existsSync(path.join(d, 'src/refunds.ts'))).toBe(true);
  });

  it('applies after approve', async () => {
    const d = project();
    await draftRefundPlan(d);
    await bp(d, ['plan', 'ready', 'refund-support']);
    await bp(d, ['plan', 'approve', 'refund-support']);
    expect((await bp(d, ['plan', 'apply', 'refund-support'])).code).toBe(0);
  });

  it('archives and drops plans', async () => {
    const d = project();
    await bp(d, ['plan', 'new', 'one']);
    await bp(d, ['plan', 'new', 'two']);
    expect((await bp(d, ['plan', 'archive', 'one'])).code).toBe(0);
    expect(fs.existsSync(path.join(d, '.blueprint/archive/one/plan.json'))).toBe(true);
    expect((await bp(d, ['plan', 'drop', 'two'])).code).toBe(0);
    expect((await bp(d, ['plan', 'list'])).out).toContain('no plans yet');
    // ids can't reach outside the plans folder
    expect((await bp(d, ['plan', 'drop', '../archive'])).code).toBe(1);
  });

  it('reads a draft from stdin', async () => {
    const d = project();
    await bp(d, ['plan', 'new', 'tiny']);
    const r = await bp(d, ['plan', 'add', 'tiny', 'src/extra.ts'], 'export function extra(): number {\n  return 1;\n}\n');
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(d, '.blueprint/plans/tiny/files/src/extra.ts'), 'utf8')).toContain('extra');
    const list = await bp(d, ['plan', 'list']);
    expect(list.out).toContain('tiny');
  });

  it('refuses ids and paths that could escape the plan folder', async () => {
    const d = project();
    expect((await bp(d, ['plan', 'new', '../evil'])).code).toBe(1);
    await bp(d, ['plan', 'new', 'ok']);
    const r = await bp(d, ['plan', 'add', 'ok', '../outside.ts'], 'x');
    expect(r.code).toBe(1);
    expect(r.err).toContain('relative path inside the project');
    expect((await bp(d, ['plan', 'add', 'ok', '/etc/passwd'], 'x')).code).toBe(1);
    expect((await bp(d, ['plan', 'add', 'ok', '.blueprint/x.ts'], 'x')).code).toBe(1);
  });

  it('says so when there is no plan', async () => {
    const d = project();
    const r = await bp(d, ['check']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('no plans yet');
  });
});
