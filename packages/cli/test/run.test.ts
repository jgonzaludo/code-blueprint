import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ordersDemo = path.join(repo, 'examples/orders-demo');

async function bp(args: string[], cwd = ordersDemo) {
  let out = '';
  let err = '';
  const code = await run(args, { out: (s) => (out += s), err: (s) => (err += s), cwd });
  return { code, out, err };
}

describe('blueprint print', () => {
  it('prints the section 13 tree for a file', async () => {
    const r = await bp(['print', 'src/orders.ts']);
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      [
        'processOrder  src/orders.ts:68',
        '├─ calculateOrderTotal  :49',
        '│  ├─ roundMoney  src/utils/money.ts:2',
        '│  └─ Inventory.getProduct  :28',
        '├─ reserveOrderStock  :59',
        '│  └─ Inventory.reserve  :38',
        '│     └─ Inventory.getProduct  :28 (above)',
        '└─ recordAudit  src/audit/log.ts:7',
        '',
      ].join('\n'),
    );
  });

  it('emits the same data as json', async () => {
    const r = await bp(['print', 'src/orders.ts', '--json']);
    const j = JSON.parse(r.out);
    expect(j.files).toHaveLength(1);
    expect(j.files[0].file).toBe('src/orders.ts');
    expect(j.files[0].roots[0].name).toBe('processOrder');
    expect(j.files[0].roots[0].children.map((c: { name: string }) => c.name)).toEqual([
      'calculateOrderTotal',
      'reserveOrderStock',
      'recordAudit',
    ]);
  });

  it('prints every file in a directory with headers', async () => {
    const r = await bp(['print', 'src']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('== src/orders.ts ==');
    expect(r.out).toContain('== src/utils/money.ts ==\nroundMoney  src/utils/money.ts:2');
  });

  it('honors --root and --depth', async () => {
    const r = await bp(['print', 'src/orders.ts', '--root', ordersDemo, '--depth', '2'], repo);
    expect(r.code).toBe(0);
    expect(r.out.startsWith('processOrder  src/orders.ts:68')).toBe(true);
  });

  it('uses only ascii and box drawing glyphs', async () => {
    const r = await bp(['print', 'src/orders.ts']);
    expect(r.out).not.toMatch(/[^\x20-\x7e\n│├└─]/);
  });
});

describe('usage errors', () => {
  it('shows help with --help', async () => {
    const r = await bp(['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('usage:');
  });
  it('says planned commands are not built', async () => {
    const r = await bp(['tui']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('not built yet');
  });
  it('fails cleanly on a missing file', async () => {
    const r = await bp(['print', 'src/nope.ts']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('does not exist');
  });
  it('rejects a bad depth', async () => {
    const r = await bp(['print', 'src/orders.ts', '--depth', '0']);
    expect(r.code).toBe(2);
  });
});

describe('blueprint status', () => {
  it('says not running when there is no watcher', async () => {
    const r = await bp(['status']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('not running');
    const j = await bp(['status', '--json']);
    expect(JSON.parse(j.out).running).toBe(false);
  });
});
