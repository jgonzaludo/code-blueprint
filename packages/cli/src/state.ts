import { appliedGraph, checkPlan, isTestPath, parseTree, planGraph, type CheckResult, type Graph, type ParsedTree, type ReviewState } from '@blueprint/core';
import { allCards, type Positions } from '@blueprint/core/layout';
import type { GraphBuilder } from './graph.js';
import { placeFiles, placePlan, readLayoutCache, writeLayoutCache } from './layout.js';
import { baseOverlay, listPlans, readPlan, reviewOf } from './plans.js';

// everything the map page needs, computed in one place so the live server and `snapshot` agree.

export interface PlanState {
  id: string;
  title: string;
  state: 'proposed' | 'applied';
  // where it is in review, and what the user said if they asked for changes
  review: { state: ReviewState; note?: string; at?: string };
  files: number;
  claims: number;
  // the proposal against the pre-plan code, and what the code looks like now with the check on it
  planGraph: Graph;
  appliedGraph: Graph;
  positions: Positions;
  check: CheckResult;
}

export interface PlanSummary {
  id: string;
  title: string;
  created: string;
  files: number;
  claims: number;
  review: ReviewState;
}

export interface MapState {
  rev: number;
  graph: Graph;
  positions: Positions;
  plans: PlanSummary[];
  plan: PlanState | null;
}

export interface ComputeOptions {
  root: string;
  includeTests: boolean;
  relayout?: boolean;
  // which plan to show. default is the newest.
  planId?: string;
  // the live server remembers positions so files never move. snapshot only reads them.
  writeCache?: boolean;
}

// the plan on disk (newest unless asked), parsed three ways: pre-plan code, the draft, and the code now
function loadPlan(root: string, o: ComputeOptions, disk: ParsedTree, cache: Positions): { plan: PlanState; positions: Positions } | null {
  const all = listPlans(root);
  const pick = o.planId ? all.find((p) => p.id === o.planId) : all[all.length - 1];
  if (!pick) return null;
  const { plan, baseline, overlay } = readPlan(root, pick.id);
  const planned = new Set([...plan.files, ...plan.delete]);
  const exclude = o.includeTests ? undefined : (rel: string) => isTestPath(rel) && !planned.has(rel);
  const draft = parseTree(root, { overlay, exclude, diagnostics: false });
  const bo = baseOverlay(root, plan);
  const base = bo.size ? parseTree(root, { overlay: bo, exclude, diagnostics: false }) : disk;
  const check = checkPlan(disk, draft, plan, baseline);
  const pg = planGraph(base, draft, plan);
  const ag = appliedGraph(base, disk, plan, check);
  // one set of positions for both views, so switching modes never shuffles the map
  const union: Graph = { ...pg, fstat: { ...ag.fstat, ...pg.fstat }, fedges: [...pg.fedges, ...ag.fedges] };
  const cards = { ...allCards(ag), ...allCards(pg) };
  const positions = placePlan(union, cards, cache);
  const applied =
    plan.files.length > 0 &&
    plan.files.every((f) => overlay.get(f) !== undefined && disk.texts.get(f) === overlay.get(f)) &&
    plan.delete.every((f) => !disk.texts.has(f));
  return {
    plan: {
      id: plan.id,
      title: plan.title,
      state: applied ? 'applied' : 'proposed',
      review: { state: reviewOf(plan), note: plan.review?.note, at: plan.review?.at },
      files: plan.files.length,
      claims: plan.claims.length,
      planGraph: pg,
      appliedGraph: ag,
      positions,
      check,
    },
    positions,
  };
}

export async function computeState(builder: GraphBuilder, o: ComputeOptions): Promise<Omit<MapState, 'rev'>> {
  const { graph, tree } = builder.build();
  let cache = readLayoutCache(o.root);
  const positions = await placeFiles(graph, allCards(graph), cache, o.relayout);
  cache = { ...(cache ?? {}), ...positions };
  // plan files get a band above the map, and the cache remembers it so applying doesn't move them
  const loaded = loadPlan(o.root, o, tree, cache);
  if (loaded) cache = { ...cache, ...loaded.positions };
  if (o.writeCache !== false) writeLayoutCache(o.root, cache);
  const plans = listPlans(o.root).map((p) => ({ id: p.id, title: p.title, created: p.created, files: p.files.length, claims: p.claims.length, review: reviewOf(p) }));
  return { graph, positions, plans, plan: loaded?.plan ?? null };
}
