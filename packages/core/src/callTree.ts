import type { BlockId, Member, ParsedBlock, ParsedEdge, ParsedTree } from './types.js';

// the data behind `blueprint print`: for one file, the entry points and what they call, in call order.
// parser facts only, nothing here is guessed.

export interface CallNode {
  name: string; // "processOrder" or "Inventory.reserve"
  file: string; // repo-relative
  line: number; // declaration line
  seen?: boolean; // already expanded earlier in this tree, so children are left out
  children: CallNode[];
}

export interface FileTree {
  file: string;
  roots: CallNode[];
}

export interface TreeOptions {
  // how many file hops out to expand. 1 lists callees in other files but not what they call.
  depth?: number;
}

interface Unit {
  key: string;
  name: string;
  block: ParsedBlock;
  member?: Member;
  line: number;
  // line span, only matters for class members (calls inside a class block get split by member)
  span: [number, number];
}

const COMMENT = /^\s*(\/\/|\/\*|\*)/;

// first line of the declaration itself, skipping the comments above it
function declLine(b: ParsedBlock): number {
  const i = b.code.findIndex((l) => !COMMENT.test(l));
  return b.lineNums[i < 0 ? 0 : i] as number;
}

// methods and arrow-fn props, not plain data props
const METHOD = /^\s*(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*\*?\s*#?[\w$]+\s*(?:<[^(]*>)?\s*\(/;
const ARROW_PROP = /^\s*(?:(?:public|private|protected|static|readonly)\s+)*#?[\w$]+\s*[:=][^=]*(?:=>|function)/;
const isCallable = (text: string) => METHOD.test(text) || ARROW_PROP.test(text);

export function buildFileTree(tree: ParsedTree, file: string, opts: TreeOptions = {}): FileTree {
  const depth = Math.max(1, opts.depth ?? 1);
  const lineAt = (f: string, line: number) => (tree.texts.get(f) ?? '').split('\n')[line - 1] ?? '';

  // units per block: a class becomes one unit per method, anything else is one unit
  const unitsOf = new Map<BlockId, Unit[]>();
  const unitsFor = (b: ParsedBlock): Unit[] => {
    const hit = unitsOf.get(b.id);
    if (hit) return hit;
    let units: Unit[];
    if (b.kind === 'class') {
      const ms = [...b.members].sort((x, y) => x.line - y.line);
      units = ms
        .filter((m) => isCallable(lineAt(b.file, m.line)))
        .map((m) => {
          const next = ms.find((o) => o.line > m.line);
          return {
            key: `${b.id}#${m.line}`,
            name: `${b.name}.${m.name}`,
            block: b,
            member: m,
            line: m.line,
            span: [m.line, next ? next.line - 1 : b.end] as [number, number],
          };
        });
    } else {
      const name = b.kind === 'module' ? '(top-level)' : b.name;
      units = [{ key: b.id, name, block: b, line: declLine(b), span: [b.start, b.end] }];
    }
    unitsOf.set(b.id, units);
    return units;
  };

  // outgoing calls per block, regular and intra-class
  const out = new Map<BlockId, ParsedEdge[]>();
  for (const e of [...tree.edges.values(), ...tree.selfEdges.values()]) {
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
  }

  // which unit does an edge land on
  const targetUnit = (e: ParsedEdge): Unit | undefined => {
    const tb = tree.blocks.get(e.to);
    if (!tb) return undefined;
    const us = unitsFor(tb);
    if (tb.kind !== 'class') return us[0];
    return (
      us.find((u) => u.line === e.targetLine) ??
      us.find((u) => u.member?.name === 'constructor') ??
      // class with no ctor (or a non-callable target line): show the class itself
      { key: tb.id, name: tb.name, block: tb, line: declLine(tb), span: [tb.start, tb.end] }
    );
  };

  const callsOf = (u: Unit): Unit[] => {
    const es = (out.get(u.block.id) ?? [])
      .filter((e) => u.member === undefined || (e.callLine !== undefined && e.callLine >= u.span[0] && e.callLine <= u.span[1]))
      .sort((a, b) => (a.callLine ?? 0) - (b.callLine ?? 0));
    const seenKeys = new Set<string>([u.key]);
    const res: Unit[] = [];
    for (const e of es) {
      const t = targetUnit(e);
      if (!t || seenKeys.has(t.key)) continue;
      seenKeys.add(t.key);
      res.push(t);
    }
    return res;
  };

  // candidates: callables in this file
  const fileBlocks = [...tree.blocks.values()].filter((b) => b.file === file);
  const candidates: Unit[] = [];
  for (const b of fileBlocks) {
    if (b.kind === 'function' || b.kind === 'const') candidates.push(...unitsFor(b));
    // methods only count as entry points when they call something, a bare ctor is noise
    else if (b.kind === 'class') candidates.push(...unitsFor(b).filter((u) => callsOf(u).length));
    else if (b.kind === 'module') {
      const u = unitsFor(b)[0] as Unit;
      if (callsOf(u).length) candidates.push(u);
    }
  }
  candidates.sort((a, b) => a.line - b.line);

  // roots: nothing else in this file calls them
  const called = new Set<string>();
  for (const u of candidates) {
    for (const t of callsOf(u)) if (t.block.file === file && t.key !== u.key) called.add(t.key);
  }
  let rootUnits = candidates.filter((u) => !called.has(u.key));
  if (!rootUnits.length) rootUnits = candidates; // everything calls everything, list it all

  const seen = new Set<string>();
  const expand = (u: Unit, hopsLeft: number): CallNode => {
    const node: CallNode = { name: u.name, file: u.block.file, line: u.line, children: [] };
    if (seen.has(u.key)) {
      node.seen = true;
      return node;
    }
    seen.add(u.key);
    for (const c of callsOf(u)) {
      if (c.block.file === u.block.file) node.children.push(expand(c, hopsLeft));
      else if (hopsLeft > 1) node.children.push(expand(c, hopsLeft - 1));
      else node.children.push({ name: c.name, file: c.block.file, line: c.line, children: [] });
    }
    return node;
  };

  return { file, roots: rootUnits.map((u) => expand(u, depth)) };
}
