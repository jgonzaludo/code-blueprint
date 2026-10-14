import { buildGraph } from './diff.js';
import type { BlockId, Edge, Graph, ParsedEdge, ParsedTree } from './types.js';

// plan protocol, CONTEXT.md section 9. a plan is a set of full draft files plus a few claims,
// parsed as an overlay on disk. nothing here touches the file system, callers pass parsed trees.

export interface PlanClaim {
  from: BlockId;
  to: BlockId;
  note?: string;
}

export interface PlanFile {
  id: string;
  title: string;
  created: string;
  files: string[]; // repo-relative, drafted files (new or changed)
  delete: string[]; // repo-relative, files the plan removes
  claims: PlanClaim[];
  // planned files that did not exist when they were added. the originals of the others are
  // captured under base/ so the plan can always be shown against the pre-plan code.
  baseAbsent?: string[];
}

// what the code looked like when the plan was started. lets check tell "the plan's new arrows"
// apart from arrows that were already there.
export interface PlanBaseline {
  edges: string[]; // from|to|callText
  blocks: string[]; // block ids
}

export const edgeKey = (e: Pick<ParsedEdge, 'from' | 'to' | 'callText'>) => `${e.from}|${e.to}|${e.callText}`;

export function baselineOf(tree: ParsedTree): PlanBaseline {
  return { edges: [...tree.edges.keys()], blocks: [...tree.blocks.keys()] };
}

// disk (before) to draft (after), with the plan's claims drawn as extra arrows
export function planGraph(disk: ParsedTree, draft: ParsedTree, plan: PlanFile): Graph {
  const graph = buildGraph(disk, draft);
  for (const e of graph.edges) e.source = 'parser';
  const claims: Edge[] = [];
  for (const c of plan.claims) {
    if (!graph.blocks[c.from] || !graph.blocks[c.to]) continue;
    // a claim the draft already backs with real code is just a normal arrow
    if (graph.edges.some((e) => e.from === c.from && e.to === c.to && e.status !== 'del')) continue;
    claims.push({
      from: c.from,
      to: c.to,
      callText: c.note ?? '',
      targetText: '',
      status: 'new',
      source: 'claim',
    });
  }
  graph.edges.push(...claims);
  graph.plan = { id: plan.id, title: plan.title, state: 'proposed', claims };
  return graph;
}

export type CheckKind = 'confirmed' | 'missing' | 'unplanned';

export interface CheckEdge {
  from: BlockId;
  to: BlockId;
  callText: string;
  source: 'parser' | 'claim';
  check: CheckKind;
  note?: string;
  callLine?: number;
  targetLine?: number;
}

export interface CheckResult {
  planId: string;
  title: string;
  summary: { confirmed: number; missing: number; unplanned: number; planned: number };
  edges: CheckEdge[];
  blocks: { missing: BlockId[]; extra: BlockId[] };
}

const fileOf = (id: BlockId) => id.split('::')[0] as string;

// applied = disk after the edit, draft = what the plan said
export function checkPlan(applied: ParsedTree, draft: ParsedTree, plan: PlanFile, baseline: PlanBaseline | null): CheckResult {
  const was = new Set(baseline?.edges ?? []);
  const wasBlocks = new Set(baseline?.blocks ?? []);
  const planned = new Set(plan.files);
  const out: CheckEdge[] = [];

  // arrows the plan introduces: draft arrows that weren't there before the plan, from planned files
  const draftKeys = new Set<string>();
  for (const [k, e] of draft.edges) {
    if (baseline ? was.has(k) : !planned.has(fileOf(e.from))) continue;
    draftKeys.add(k);
    const hit = applied.edges.get(k);
    out.push({
      from: e.from, to: e.to, callText: e.callText, source: 'parser',
      check: hit ? 'confirmed' : 'missing',
      callLine: (hit ?? e).callLine, targetLine: (hit ?? e).targetLine,
    });
  }

  // claims match on from and to only, they have no call text
  const appliedPairs = new Set([...applied.edges.values()].map((e) => `${e.from}|${e.to}`));
  const claimPairs = new Set<string>();
  for (const c of plan.claims) {
    const pair = `${c.from}|${c.to}`;
    claimPairs.add(pair);
    // if the draft code already carries this arrow, it was counted above
    const inDraft = [...draft.edges.values()].some((e) => e.from === c.from && e.to === c.to);
    if (inDraft) continue;
    out.push({ from: c.from, to: c.to, callText: c.note ?? '', source: 'claim', note: c.note, check: appliedPairs.has(pair) ? 'confirmed' : 'missing' });
  }

  // unplanned: new arrows in the real code, from planned files, that nobody planned
  for (const [k, e] of applied.edges) {
    if (was.has(k) || draftKeys.has(k)) continue;
    if (!planned.has(fileOf(e.from))) continue;
    if (claimPairs.has(`${e.from}|${e.to}`)) continue;
    out.push({ from: e.from, to: e.to, callText: e.callText, source: 'parser', check: 'unplanned', callLine: e.callLine, targetLine: e.targetLine });
  }

  // block drift: planned blocks that never got written, and new blocks nobody planned
  const missing: BlockId[] = [];
  for (const id of draft.blocks.keys()) {
    if (!planned.has(fileOf(id)) || wasBlocks.has(id)) continue;
    if (!applied.blocks.has(id)) missing.push(id);
  }
  const extra: BlockId[] = [];
  for (const id of applied.blocks.keys()) {
    if (!planned.has(fileOf(id)) || wasBlocks.has(id) || draft.blocks.has(id)) continue;
    extra.push(id);
  }

  const count = (k: CheckKind) => out.filter((e) => e.check === k).length;
  return {
    planId: plan.id,
    title: plan.title,
    summary: {
      confirmed: count('confirmed'),
      missing: count('missing'),
      unplanned: count('unplanned'),
      planned: count('confirmed') + count('missing'),
    },
    edges: out,
    blocks: { missing: missing.sort(), extra: extra.sort() },
  };
}

// the "after applying" view: pre-plan code against the code on disk now, with each arrow marked
// by what the check found. planned arrows the code doesn't have are added back as missing.
export function appliedGraph(base: ParsedTree, disk: ParsedTree, plan: PlanFile, check: CheckResult): Graph {
  const graph = buildGraph(base, disk);
  for (const e of graph.edges) e.source = 'parser';
  const marks = new Map<string, CheckEdge>();
  for (const c of check.edges) marks.set(`${c.from}|${c.to}|${c.callText}`, c);
  for (const e of graph.edges) {
    const m = marks.get(`${e.from}|${e.to}|${e.callText}`);
    if (m && m.source === 'parser') e.check = m.check;
  }
  // claims the code satisfied: mark the matching parser arrow
  for (const c of check.edges) {
    if (c.source !== 'claim' || c.check !== 'confirmed') continue;
    for (const e of graph.edges) if (e.from === c.from && e.to === c.to && e.status !== 'del') e.check = 'confirmed';
  }
  for (const c of check.edges) {
    if (c.check !== 'missing') continue;
    if (!graph.blocks[c.from] || !graph.blocks[c.to]) continue;
    graph.edges.push({
      from: c.from, to: c.to, callText: c.callText, targetText: '', status: 'new',
      source: c.source, check: 'missing', callLine: c.callLine, targetLine: c.targetLine,
    });
  }
  graph.plan = {
    id: plan.id,
    title: plan.title,
    state: 'checked',
    claims: graph.edges.filter((e) => e.source === 'claim'),
    summary: { confirmed: check.summary.confirmed, missing: check.summary.missing, unplanned: check.summary.unplanned },
  };
  return graph;
}

// keep only some files and what touches them. used to make a small snapshot of a plan:
// the plan's files plus one hop of neighbours.
export function restrictGraph(g: Graph, keep: Set<string>): Graph {
  const fileOf = (id: string) => id.split('::')[0] as string;
  const blocks: Graph['blocks'] = {};
  for (const [id, b] of Object.entries(g.blocks)) if (keep.has(b.file)) blocks[id] = b;
  return {
    ...g,
    blocks,
    edges: g.edges.filter((e) => keep.has(fileOf(e.from)) && keep.has(fileOf(e.to))),
    fedges: g.fedges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    fstat: Object.fromEntries(Object.entries(g.fstat).filter(([f]) => keep.has(f))),
    ftext: Object.fromEntries(Object.entries(g.ftext).filter(([f]) => keep.has(f))),
  };
}

// the files a plan touches plus every file one import away, in either direction
export function planNeighbourhood(g: Graph, planFiles: Iterable<string>): Set<string> {
  const keep = new Set<string>(planFiles);
  const core = new Set(keep);
  for (const e of g.fedges) {
    if (core.has(e.from)) keep.add(e.to);
    if (core.has(e.to)) keep.add(e.from);
  }
  for (const e of g.edges) {
    const f = e.from.split('::')[0] as string;
    const t = e.to.split('::')[0] as string;
    if (core.has(f)) keep.add(t);
    if (core.has(t)) keep.add(f);
  }
  return keep;
}
