import { buildGraph, isSourcePath, isTestPath, parseTree, type Graph, type ParsedTree } from '@blueprint/core';
import { headFiles, headSha } from './git.js';

export interface GraphOptions {
  root: string;
  // HEAD: diff against the last commit. disk: diff against the files as they were at start.
  baseline: 'HEAD' | 'disk';
  includeTests: boolean;
}

// builds the Graph for a project, caching the baseline so a save only re-parses the "after" side
export class GraphBuilder {
  private baseTree: ParsedTree | null = null;
  private baseKey: string | null = null;
  baselineLabel: string;

  constructor(private opts: GraphOptions) {
    this.baselineLabel = opts.baseline;
  }

  private exclude = (rel: string) => !this.opts.includeTests && isTestPath(rel);

  private baseline(): ParsedTree {
    const { root } = this.opts;
    if (this.opts.baseline === 'HEAD') {
      const sha = headSha(root);
      if (sha) {
        if (this.baseTree && this.baseKey === sha) return this.baseTree;
        const files = headFiles(root, isSourcePath);
        this.baseTree = parseTree(root, {
          overlay: files,
          overlayOnly: true,
          exclude: this.exclude,
          diagnostics: false,
        });
        this.baseKey = sha;
        this.baselineLabel = `HEAD ${sha.slice(0, 7)}`;
        return this.baseTree;
      }
      // no git or no commits yet, fall back to the files as they are now
    }
    if (!this.baseTree || this.baseKey !== 'disk') {
      this.baseTree = parseTree(root, { exclude: this.exclude, diagnostics: false });
      this.baseKey = 'disk';
      this.baselineLabel = 'disk';
    }
    return this.baseTree;
  }

  // the tree for `print` and friends, same filters as the graph
  parseDisk(): ParsedTree {
    return parseTree(this.opts.root, { exclude: this.exclude });
  }

  build(): { graph: Graph; tree: ParsedTree } {
    const t0 = performance.now();
    const before = this.baseline();
    const after = this.parseDisk();
    const graph = buildGraph(before, after);
    graph.meta = {
      root: this.opts.root,
      baseline: this.baselineLabel,
      parsedAt: new Date().toISOString(),
      files: after.files.length,
      ms: Math.round(performance.now() - t0),
      typeErrors: after.typeErrors,
    };
    return { graph, tree: after };
  }
}
