import { buildGraph } from './diff.js';
import { parseTree, type ParseOptions } from './parse.js';
import type { Graph } from './types.js';

export * from './types.js';
export { parseTree, loadCompilerOptions, defaultOptions, type ParseOptions } from './parse.js';
export { buildGraph, lcs } from './diff.js';

// parse two trees on disk and diff them (before = baseline, after = new)
export function parseAndDiff(beforeRoot: string, afterRoot: string, opts: { before?: ParseOptions; after?: ParseOptions } = {}): Graph {
  const t0 = Date.now();
  const before = parseTree(beforeRoot, opts.before);
  const after = parseTree(afterRoot, opts.after);
  const graph = buildGraph(before, after);
  graph.meta = {
    root: afterRoot,
    baseline: beforeRoot,
    parsedAt: new Date().toISOString(),
    files: after.files.length,
    ms: Date.now() - t0,
    typeErrors: after.typeErrors,
  };
  return graph;
}
