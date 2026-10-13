import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAndDiff } from '../src/index.js';

const demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/refund-demo');
const graph = parseAndDiff(path.join(demo, 'before'), path.join(demo, 'after'));

describe('refund demo golden', () => {
  it('has the headline numbers from CONTEXT.md section 7', () => {
    expect(Object.keys(graph.blocks)).toHaveLength(24);
    expect(graph.edges).toHaveLength(18);
    expect(graph.edges.filter((e) => e.status === 'new')).toHaveLength(9);
    expect(graph.fedges).toHaveLength(9);
  });

  it('has the expected file stats', () => {
    expect(graph.fstat).toEqual({
      'src/orders.ts': 'mod',
      'src/refunds.ts': 'new',
      'src/api/refundHandler.ts': 'new',
      'src/api/checkout.ts': 'same',
      'src/jobs/retry.ts': 'same',
      'src/utils/money.ts': 'same',
      'src/audit/log.ts': 'same',
    });
  });

  it('modifies OrderStatus (-1 +1) and Inventory (+6)', () => {
    const count = (id: string, d: string) => graph.blocks[id]?.lines.filter((l) => l.d === d).length;
    expect(graph.blocks['src/orders.ts::OrderStatus']?.status).toBe('mod');
    expect([count('src/orders.ts::OrderStatus', '-'), count('src/orders.ts::OrderStatus', '+')]).toEqual([1, 1]);
    expect(graph.blocks['src/orders.ts::Inventory']?.status).toBe('mod');
    expect([count('src/orders.ts::Inventory', '-'), count('src/orders.ts::Inventory', '+')]).toEqual([0, 6]);
  });

  it('has a whole-file diff of +7 -1 for orders.ts', () => {
    const t = graph.ftext['src/orders.ts'] ?? [];
    expect([t.filter((l) => l.d === '+').length, t.filter((l) => l.d === '-').length]).toEqual([7, 1]);
  });

  it('matches the prototype graph json exactly', () => {
    const expected = JSON.parse(fs.readFileSync(path.join(demo, 'expected/graph.json'), 'utf8'));
    // fields added after the prototype (anchors, exported, meta) get stripped, the rest must match exactly
    const got = JSON.parse(JSON.stringify(graph));
    delete got.meta;
    for (const e of got.edges) for (const k of ['callLine', 'targetLine', 'source', 'resolution']) delete e[k];
    for (const b of Object.values(got.blocks) as { exported?: boolean }[]) delete b.exported;
    expect(got).toEqual(expected);
  });
});
