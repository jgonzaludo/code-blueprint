import fs from 'node:fs';
import path from 'node:path';
import type { PlanBaseline, PlanClaim, PlanFile, ReviewState } from '@blueprint/core';
import { ensureStateDir } from './layout.js';

// plans live on disk under .blueprint/plans/<id>/, so any agent can write one with no server running:
//   plan.json      id, title, files, delete, claims
//   baseline.json  edge and block keys from when the plan was started
//   files/<rel>    full draft contents of each new or changed file

export const plansDir = (root: string) => path.join(root, '.blueprint', 'plans');
export const planDir = (root: string, id: string) => path.join(plansDir(root), id);

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class PlanError extends Error {}

export function checkId(id: string): void {
  if (!ID.test(id)) throw new PlanError(`bad plan id '${id}'. use lowercase letters, numbers, - and _ (max 64)`);
}

// a draft path must be a plain relative path that stays inside the project
export function checkRel(root: string, rel: string): string {
  const norm = rel.split(path.sep).join('/').replace(/^\.\//, '');
  if (!norm || path.isAbsolute(norm) || norm.split('/').includes('..') || norm.startsWith('.blueprint/')) {
    throw new PlanError(`'${rel}' must be a relative path inside the project`);
  }
  const abs = path.resolve(root, norm);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new PlanError(`'${rel}' is outside the project`);
  return norm;
}

const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const writeJson = (f: string, v: unknown) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(v, null, 2)}\n`);
  fs.renameSync(tmp, f);
};

export function listPlans(root: string): PlanFile[] {
  const dir = plansDir(root);
  if (!fs.existsSync(dir)) return [];
  const out: PlanFile[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      out.push(readJson<PlanFile>(path.join(dir, e.name, 'plan.json')));
    } catch {
      // half written or hand edited into nonsense, skip it
    }
  }
  return out.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

// the id to use when none is given: the newest plan
export function resolveId(root: string, id?: string): string {
  if (id) {
    checkId(id);
    if (!fs.existsSync(path.join(planDir(root, id), 'plan.json'))) throw new PlanError(`no plan '${id}' here. try: blueprint plan list`);
    return id;
  }
  const all = listPlans(root);
  const last = all[all.length - 1];
  if (!last) throw new PlanError('no plans yet. start one with: blueprint plan new <id> --title "..."');
  return last.id;
}

export function readPlan(root: string, id: string): { plan: PlanFile; baseline: PlanBaseline | null; overlay: Map<string, string | null> } {
  const dir = planDir(root, id);
  const plan = readJson<PlanFile>(path.join(dir, 'plan.json'));
  let baseline: PlanBaseline | null = null;
  try {
    baseline = readJson<PlanBaseline>(path.join(dir, 'baseline.json'));
  } catch {
    // a hand-made plan may have none, check falls back to "everything from planned files"
  }
  const overlay = new Map<string, string | null>();
  for (const rel of plan.files) {
    const f = path.join(dir, 'files', rel);
    if (fs.existsSync(f)) overlay.set(rel, fs.readFileSync(f, 'utf8'));
  }
  for (const rel of plan.delete) overlay.set(rel, null);
  return { plan, baseline, overlay };
}

// the pre-plan state of every file the plan touches: captured contents, or null where it didn't exist
export function baseOverlay(root: string, plan: PlanFile): Map<string, string | null> {
  const o = new Map<string, string | null>();
  for (const rel of [...plan.files, ...plan.delete]) {
    const f = path.join(planDir(root, plan.id), 'base', rel);
    if (fs.existsSync(f)) o.set(rel, fs.readFileSync(f, 'utf8'));
    else if (plan.baseAbsent?.includes(rel)) o.set(rel, null);
  }
  return o;
}

export function createPlan(root: string, id: string, title: string, baseline: PlanBaseline): PlanFile {
  checkId(id);
  if (fs.existsSync(path.join(planDir(root, id), 'plan.json'))) throw new PlanError(`plan '${id}' already exists`);
  ensureStateDir(root);
  const plan: PlanFile = { id, title: title || id, created: new Date().toISOString(), files: [], delete: [], claims: [] };
  writeJson(path.join(planDir(root, id), 'plan.json'), plan);
  writeJson(path.join(planDir(root, id), 'baseline.json'), baseline);
  return plan;
}

// a plan that changed after it was marked ready or approved is a different plan, review again
function resetReview(p: PlanFile): void {
  if (p.review && p.review.state !== 'drafting') p.review = { state: 'drafting', at: new Date().toISOString() };
}

function update(root: string, id: string, fn: (p: PlanFile) => void): PlanFile {
  const f = path.join(planDir(root, id), 'plan.json');
  const plan = readJson<PlanFile>(f);
  fn(plan);
  writeJson(f, plan);
  return plan;
}

// remember what a file looked like before the plan touched it, once
function captureBase(root: string, id: string, rel: string): void {
  const dest = path.join(planDir(root, id), 'base', rel);
  const plan = readJson<PlanFile>(path.join(planDir(root, id), 'plan.json'));
  if (fs.existsSync(dest) || plan.baseAbsent?.includes(rel)) return;
  const src = path.join(root, rel);
  if (fs.existsSync(src) && fs.statSync(src).isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  } else {
    update(root, id, (p) => {
      p.baseAbsent = [...(p.baseAbsent ?? []), rel];
    });
  }
}

export function addDraft(root: string, id: string, rel: string, content: string): PlanFile {
  const r = checkRel(root, rel);
  captureBase(root, id, r);
  const dest = path.join(planDir(root, id), 'files', r);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  return update(root, id, (p) => {
    if (!p.files.includes(r)) p.files.push(r);
    p.delete = p.delete.filter((d) => d !== r);
    resetReview(p);
  });
}

export function removeFile(root: string, id: string, rel: string): PlanFile {
  const r = checkRel(root, rel);
  captureBase(root, id, r);
  fs.rmSync(path.join(planDir(root, id), 'files', r), { force: true });
  return update(root, id, (p) => {
    p.files = p.files.filter((f) => f !== r);
    if (!p.delete.includes(r)) p.delete.push(r);
    resetReview(p);
  });
}

export function addClaim(root: string, id: string, claim: PlanClaim): PlanFile {
  return update(root, id, (p) => {
    if (!p.claims.some((c) => c.from === claim.from && c.to === claim.to)) p.claims.push(claim);
    resetReview(p);
  });
}

// copy drafts over the real files, delete what the plan deletes. returns what was touched.
export function applyPlan(root: string, id: string): { written: string[]; deleted: string[] } {
  const { plan } = readPlan(root, id);
  const written: string[] = [];
  const deleted: string[] = [];
  for (const rel of plan.files) {
    const src = path.join(planDir(root, id), 'files', rel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(root, checkRel(root, rel));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    written.push(rel);
  }
  for (const rel of plan.delete) {
    fs.rmSync(path.join(root, checkRel(root, rel)), { force: true });
    deleted.push(rel);
  }
  return { written, deleted };
}

export const reviewOf = (p: PlanFile): ReviewState => (p.files.length || p.delete.length ? (p.review?.state ?? 'drafting') : 'drafting');

export function setReview(root: string, id: string, state: ReviewState, note?: string): PlanFile {
  const cur = readJson<PlanFile>(path.join(planDir(root, id), 'plan.json'));
  if (state === 'ready' && !cur.files.length && !cur.delete.length) throw new PlanError(`plan '${id}' has no files yet. add drafts first`);
  if (state === 'approved' && reviewOf(cur) === 'drafting') throw new PlanError(`plan '${id}' is still drafting. mark it ready first: blueprint plan ready ${id}`);
  return update(root, id, (p) => {
    p.review = { state, at: new Date().toISOString(), ...(note ? { note: note.slice(0, 500) } : {}) };
  });
}

export const archiveDir = (root: string) => path.join(root, '.blueprint', 'archive');

// move a finished plan out of the way. it stays on disk, it just stops being listed.
export function archivePlan(root: string, id: string): string {
  const from = planDir(root, id);
  const to = path.join(archiveDir(root), id);
  fs.mkdirSync(archiveDir(root), { recursive: true });
  if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
  fs.renameSync(from, to);
  return to;
}

// forget a plan completely. only ever touches its own folder under .blueprint/plans.
export function dropPlan(root: string, id: string): void {
  checkId(id);
  fs.rmSync(planDir(root, id), { recursive: true, force: true });
}
