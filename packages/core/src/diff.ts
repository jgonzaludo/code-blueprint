import fs from 'node:fs';
import path from 'node:path';
import type { Block, Edge, FileEdge, FileStat, FileText, Graph, Line, LineDiff, ParsedTree } from './types.js';

interface LcsOp {
  d: LineDiff;
  t: string;
  i?: number; // index into a (for ' ' and '-')
  j?: number; // index into b (for ' ' and '+')
}

// plain O(m*n) lcs line diff. fine per block, switch to myers for huge files (section 8.5).
export function lcs(a: string[], b: string[]): LcsOp[] {
  const m = a.length;
  const n = b.length;
  const t: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  const at = (i: number, j: number) => (t[i] as number[])[j] as number;
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      (t[i] as number[])[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: LcsOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ d: ' ', t: a[i] as string, i, j });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ d: '-', t: a[i] as string, i });
      i++;
    } else {
      out.push({ d: '+', t: b[j] as string, j });
      j++;
    }
  }
  while (i < m) out.push({ d: '-', t: a[i] as string, i: i++ });
  while (j < n) out.push({ d: '+', t: b[j] as string, j: j++ });
  return out;
}

// whole file text as lines, null when the file doesn't exist in that tree
function readLines(root: string, rel: string): string[] | null {
  try {
    const t = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
    if (t[t.length - 1] === '') t.pop();
    return t;
  } catch {
    return null;
  }
}

// diff two parsed trees into one Graph. before is the baseline, after is the new state.
export function buildGraph(before: ParsedTree, after: ParsedTree, beforeRoot: string, afterRoot: string): Graph {
  const ids = new Set([...before.blocks.keys(), ...after.blocks.keys()]);
  const blocks: Record<string, Block> = {};

  for (const id of ids) {
    const b = before.blocks.get(id);
    const a = after.blocks.get(id);
    const ref = (a ?? b)!;
    let lines: Line[];
    let status: Block['status'];
    if (!b && a) {
      status = 'new';
      lines = a.code.map((t, j) => ({ t, d: '+', o: null, n: a.start + j }));
    } else if (b && !a) {
      status = 'del';
      lines = b.code.map((t, i) => ({ t, d: '-', o: b.start + i, n: null }));
    } else {
      const bb = b!;
      const aa = a!;
      lines = lcs(bb.code, aa.code).map((x) => ({
        t: x.t,
        d: x.d,
        o: x.d !== '+' ? bb.start + (x.i as number) : null,
        n: x.d !== '-' ? aa.start + (x.j as number) : null,
      }));
      status = lines.some((l) => l.d !== ' ') ? 'mod' : 'same';
    }
    blocks[id] = { id, file: ref.file, kind: ref.kind, name: ref.name, status, lines, members: ref.members };
  }

  // edges: key is from|to|callText. in both = same, only after = new, only before = del
  const edges: Edge[] = [];
  for (const [k, e] of after.edges) edges.push({ ...e, status: before.edges.has(k) ? 'same' : 'new' });
  for (const [k, e] of before.edges) if (!after.edges.has(k)) edges.push({ ...e, status: 'del' });

  const fedges: FileEdge[] = [...after.fedges].map((k) => {
    const [from, to] = k.split('|') as [string, string];
    return { from, to, status: before.fedges.has(k) ? 'same' : 'new' };
  });

  const allFiles = new Set([...after.files, ...before.files]);
  const fstat: FileStat = {};
  for (const f of allFiles) {
    const inBlocks = Object.values(blocks).filter((x) => x.file === f);
    fstat[f] = !before.files.includes(f) ? 'new' : inBlocks.some((x) => x.status !== 'same') ? 'mod' : 'same';
  }

  const ftext: FileText = {};
  for (const f of allFiles) {
    const bt = readLines(beforeRoot, f);
    const at = readLines(afterRoot, f);
    if (!bt) ftext[f] = (at ?? []).map((t, j) => ({ d: '+', t, o: null, n: j + 1 }));
    else if (!at) ftext[f] = bt.map((t, i) => ({ d: '-', t, o: i + 1, n: null }));
    else {
      ftext[f] = lcs(bt, at).map((x) => ({
        d: x.d,
        t: x.t,
        o: x.d !== '+' ? (x.i as number) + 1 : null,
        n: x.d !== '-' ? (x.j as number) + 1 : null,
      }));
    }
  }

  return { blocks, edges, fedges, fstat, ftext };
}
