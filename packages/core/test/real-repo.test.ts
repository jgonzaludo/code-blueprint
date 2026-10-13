import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTree } from '../src/index.js';

// opt-in perf and sanity check against a real checkout. not part of the normal run.
//   BLUEPRINT_BENCH_ROOT=/path/to/src BLUEPRINT_BENCH_OUT=/tmp/report.json pnpm test
const root = process.env.BLUEPRINT_BENCH_ROOT;
const out = process.env.BLUEPRINT_BENCH_OUT;

const noTests = (rel: string) => /(^|\/)(test|tests|__tests__)\//.test(rel) || /\.(test|spec)(-d)?\.[cm]?[jt]sx?$/.test(rel);

describe.skipIf(!root)('real repo', () => {
  it('parses cold within budget', () => {
    const t0 = performance.now();
    // BLUEPRINT_BENCH_TESTS=1 keeps test files in, BLUEPRINT_BENCH_NO_DIAG=1 skips the error count
    const t = parseTree(root as string, {
      exclude: process.env.BLUEPRINT_BENCH_TESTS ? undefined : noTests,
      diagnostics: !process.env.BLUEPRINT_BENCH_NO_DIAG,
    });
    const ms = Math.round(performance.now() - t0);
    const byRes: Record<string, number> = {};
    for (const e of t.edges.values()) byRes[e.resolution ?? '?'] = (byRes[e.resolution ?? '?'] ?? 0) + 1;
    const byKind: Record<string, number> = {};
    for (const b of t.blocks.values()) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
    const report = {
      ms, files: t.files.length, blocks: t.blocks.size, edges: t.edges.size, fedges: t.fedges.size,
      typeErrors: t.typeErrors, byRes, byKind,
      edgeSample: [...t.edges.values()].slice(0, 400).map((e) => `${e.from} -> ${e.to} (call L${e.callLine}, target L${e.targetLine}) | ${e.callText}`),
    };
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
    expect(t.files.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(3000);
  }, 60_000);
});
