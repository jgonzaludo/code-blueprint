import { buildGraph } from './diff.js';
import { parseTree } from './parse.js';
import type { Graph } from './types.js';

export * from './types.js';
export { parseTree, defaultOptions } from './parse.js';
export { buildGraph, lcs } from './diff.js';

// parse two trees on disk and diff them (before = baseline, after = new)
export function parseAndDiff(beforeRoot: string, afterRoot: string): Graph {
  return buildGraph(parseTree(beforeRoot), parseTree(afterRoot), beforeRoot, afterRoot);
}
