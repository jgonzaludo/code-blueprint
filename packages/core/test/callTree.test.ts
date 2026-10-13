import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildFileTree, parseTree, type CallNode } from '../src/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ordersTree = parseTree(path.join(repo, 'examples/orders-demo'));

// indented one-liners so expectations read like the tree
const flat = (n: CallNode, depth = 0): string[] => [
  `${'  '.repeat(depth)}${n.name} ${n.file}:${n.line}${n.seen ? ' (above)' : ''}`,
  ...n.children.flatMap((c) => flat(c, depth + 1)),
];

describe('buildFileTree on the orders demo', () => {
  it('matches the CONTEXT.md section 13 example', () => {
    const t = buildFileTree(ordersTree, 'src/orders.ts');
    expect(t.roots).toHaveLength(1);
    expect(flat(t.roots[0] as CallNode)).toEqual([
      'processOrder src/orders.ts:68',
      '  calculateOrderTotal src/orders.ts:49',
      '    roundMoney src/utils/money.ts:2',
      '    Inventory.getProduct src/orders.ts:28',
      '  reserveOrderStock src/orders.ts:59',
      '    Inventory.reserve src/orders.ts:38',
      '      Inventory.getProduct src/orders.ts:28 (above)',
      '  recordAudit src/audit/log.ts:7',
    ]);
  });

  it('expands cross-file callees only when depth allows', () => {
    const shallow = buildFileTree(ordersTree, 'src/orders.ts', { depth: 1 });
    const money = flat(shallow.roots[0] as CallNode).filter((l) => l.includes('roundMoney'));
    expect(money).toHaveLength(1);
    const deep = buildFileTree(ordersTree, 'src/orders.ts', { depth: 2 });
    expect((deep.roots[0] as CallNode).children.length).toBe(3);
  });

  it('lists a leaf file with its functions and no children', () => {
    const t = buildFileTree(ordersTree, 'src/utils/money.ts');
    expect(t.roots.map((r) => r.name)).toEqual(['roundMoney']);
    expect(t.roots[0]?.children).toEqual([]);
  });
});
