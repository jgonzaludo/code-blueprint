import fs from 'node:fs';
import path from 'node:path';
import { baselineOf, checkPlan, isTestPath, parseTree, planGraph, type ParsedTree, type PlanFile } from '@blueprint/core';
import {
  PlanError, addClaim, addDraft, applyPlan, checkRel, createPlan, listPlans, readPlan, removeFile, resolveId,
} from './plans.js';
import { renderCheck, renderPlanList, renderPlanShow } from './planText.js';
import type { IO } from './run.js';

interface Opts {
  title?: string;
  from?: string;
  note?: string;
  json: boolean;
  includeTests: boolean;
}

// disk as it is now, and disk with the draft laid over it
function trees(root: string, plan: PlanFile, overlay: Map<string, string | null>, includeTests: boolean): { disk: ParsedTree; draft: ParsedTree } {
  const planned = new Set([...plan.files, ...plan.delete]);
  const exclude = includeTests ? undefined : (rel: string) => isTestPath(rel) && !planned.has(rel);
  return { disk: parseTree(root, { exclude, diagnostics: false }), draft: parseTree(root, { overlay, exclude, diagnostics: false }) };
}

// "applied" means every drafted file on disk already has the draft's exact contents
function isApplied(root: string, plan: PlanFile, overlay: Map<string, string | null>): boolean {
  if (!plan.files.length && !plan.delete.length) return false;
  for (const rel of plan.files) {
    try {
      if (fs.readFileSync(path.join(root, rel), 'utf8') !== overlay.get(rel)) return false;
    } catch {
      return false;
    }
  }
  return plan.delete.every((rel) => !fs.existsSync(path.join(root, rel)));
}

const out = (io: IO, json: boolean, v: unknown, text: string) => io.out(json ? `${JSON.stringify(v, null, 2)}\n` : `${text}\n`);

export async function planCommand(root: string, args: string[], o: Opts, io: IO): Promise<number> {
  const [sub, a, b, c] = args;
  try {
    switch (sub) {
      case 'new': {
        if (!a) throw new PlanError('usage: blueprint plan new <id> [--title "..."]');
        const baseline = baselineOf(parseTree(root, { exclude: o.includeTests ? undefined : isTestPath, diagnostics: false }));
        const plan = createPlan(root, a, o.title ?? a, baseline);
        out(io, o.json, plan, `plan '${plan.id}' started. add drafts with: blueprint plan add ${plan.id} <file>`);
        return 0;
      }
      case 'add': {
        if (!a || !b) throw new PlanError('usage: blueprint plan add <id> <file> [--from <path>]  (or pipe the contents on stdin)');
        resolveId(root, a);
        let content: string | null = null;
        if (o.from) content = fs.readFileSync(path.resolve(io.cwd, o.from), 'utf8');
        else if (io.stdin) content = await io.stdin();
        if (content === null) throw new PlanError('no contents. pass --from <path> or pipe the draft on stdin');
        const plan = addDraft(root, a, b, content);
        out(io, o.json, plan, `added ${checkRel(root, b)} to plan '${a}' (${plan.files.length} files)`);
        return 0;
      }
      case 'rm': {
        if (!a || !b) throw new PlanError('usage: blueprint plan rm <id> <file>   (marks the file as deleted by the plan)');
        resolveId(root, a);
        const plan = removeFile(root, a, b);
        out(io, o.json, plan, `plan '${a}' now deletes ${checkRel(root, b)}`);
        return 0;
      }
      case 'claim': {
        if (!a || !b || !c) throw new PlanError('usage: blueprint plan claim <id> <fromBlock> <toBlock> [--note "..."]   (blocks look like src/a.ts::name)');
        resolveId(root, a);
        const plan = addClaim(root, a, { from: b, to: c, note: o.note });
        out(io, o.json, plan, `claim added to plan '${a}': ${b} -> ${c} (${plan.claims.length} claims)`);
        return 0;
      }
      case 'list': {
        const plans = listPlans(root);
        out(io, o.json, plans, renderPlanList(plans));
        return 0;
      }
      case 'show': {
        const id = resolveId(root, a);
        const { plan, overlay } = readPlan(root, id);
        const { disk, draft } = trees(root, plan, overlay, o.includeTests);
        const g = planGraph(disk, draft, plan);
        const state = isApplied(root, plan, overlay) ? 'applied' : 'proposed';
        if (o.json) {
          const changed = Object.values(g.blocks).filter((x) => x.status !== 'same' && x.kind !== 'imports');
          io.out(
            `${JSON.stringify(
              {
                plan, state,
                files: g.fstat,
                blocks: changed.map((x) => ({ id: x.id, status: x.status, changedLines: x.lines.filter((l) => l.d !== ' ') })),
                edges: g.edges.filter((e) => e.status === 'new' || e.source === 'claim'),
              },
              null,
              2,
            )}\n`,
          );
        } else io.out(`${renderPlanShow(g, plan, state)}\n`);
        return 0;
      }
      case 'apply': {
        const id = resolveId(root, a);
        const r = applyPlan(root, id);
        out(io, o.json, r, `applied plan '${id}': wrote ${r.written.length} files, deleted ${r.deleted.length}. next: blueprint check ${id}`);
        return 0;
      }
      default:
        io.err('usage: blueprint plan <new|add|rm|claim|list|show|apply> ...\n');
        return 2;
    }
  } catch (e) {
    if (e instanceof PlanError || (e as NodeJS.ErrnoException).code === 'ENOENT') {
      io.err(`blueprint: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    throw e;
  }
}

export async function checkCommand(root: string, id: string | undefined, o: Opts, io: IO): Promise<number> {
  try {
    const rid = resolveId(root, id);
    const { plan, baseline, overlay } = readPlan(root, rid);
    const { disk, draft } = trees(root, plan, overlay, o.includeTests);
    // disk is the applied code, draft is what the plan said
    const r = checkPlan(disk, draft, plan, baseline);
    out(io, o.json, r, renderCheck(r));
    return 0;
  } catch (e) {
    if (e instanceof PlanError) {
      io.err(`blueprint: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}
