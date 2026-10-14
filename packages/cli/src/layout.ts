import fs from 'node:fs';
import path from 'node:path';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { Graph } from '@blueprint/core';
import type { CardSize, Positions } from '@blueprint/core/layout';

// where whole file cards sit on the map.
// stability rule (CONTEXT principle 3): a re-parse only places new files and never moves
// existing ones. positions are cached in .blueprint/layout.json until someone asks to re-layout.

const FILE = (root: string) => path.join(root, '.blueprint', 'layout.json');

// .blueprint ignores itself, so it never shows up as untracked noise and we don't touch your .gitignore
export function ensureStateDir(root: string): void {
  const dir = path.join(root, '.blueprint');
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
}

export function readLayoutCache(root: string): Positions | null {
  try {
    const j = JSON.parse(fs.readFileSync(FILE(root), 'utf8')) as { version?: number; positions?: Positions };
    return j.version === 1 && j.positions ? j.positions : null;
  } catch {
    return null;
  }
}

export function writeLayoutCache(root: string, positions: Positions): void {
  const f = FILE(root);
  ensureStateDir(root);
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, positions }, null, 1));
  fs.renameSync(tmp, f);
}

// room for arrows to run between cards. arrows are drawn under the blocks, so they need clear lanes.
export const GAP_X = 320;
export const GAP_Y = 120;

// full layered layout of the file graph, entry points left and leaves right
async function elkLayout(graph: Graph, cards: Record<string, CardSize>): Promise<Positions> {
  const files = Object.keys(cards).sort();
  const ids = new Set(files);
  const elk = new ELK();
  const res = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': String(GAP_Y),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(GAP_X),
      'elk.layered.crossingMinimization.semiInteractive': 'false',
    },
    children: files.map((f) => ({ id: f, width: (cards[f] as CardSize).w, height: (cards[f] as CardSize).h })),
    edges: graph.fedges
      .filter((e) => e.status !== 'del' && ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
      .map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  });
  const out: Positions = {};
  for (const c of res.children ?? []) out[c.id] = { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) };
  return out;
}

export async function placeFiles(
  graph: Graph,
  cards: Record<string, CardSize>,
  cached: Positions | null,
  relayout = false,
): Promise<Positions> {
  const files = Object.keys(cards).sort();
  if (!files.length) return {};
  if (!cached || relayout || !Object.keys(cached).some((f) => cards[f])) return elkLayout(graph, cards);

  const out: Positions = {};
  let maxRight = -Infinity;
  let minY = Infinity;
  for (const f of files) {
    const p = cached[f];
    if (!p) continue;
    out[f] = p;
    maxRight = Math.max(maxRight, p.x + (cards[f] as CardSize).w);
    minY = Math.min(minY, p.y);
  }
  // new files go in a fresh column to the right of everything, stacked
  let y = Number.isFinite(minY) ? minY : 0;
  const x = Number.isFinite(maxRight) ? maxRight + GAP_X : 0;
  for (const f of files) {
    if (out[f]) continue;
    out[f] = { x, y };
    y += (cards[f] as CardSize).h + GAP_Y;
  }
  return unoverlap(out, cards);
}

// a file that grew can run into the one below it. the only time an existing file moves:
// the lower one of an overlapping pair is pushed down just far enough to clear.
export function unoverlap(pos: Positions, cards: Record<string, CardSize>): Positions {
  const files = Object.keys(pos).filter((f) => cards[f]).sort((a, b) => (pos[a] as { y: number }).y - (pos[b] as { y: number }).y || a.localeCompare(b));
  const out: Positions = { ...pos };
  for (let pass = 0; pass < files.length; pass++) {
    let moved = false;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const a = files[i] as string;
        const b = files[j] as string;
        const pa = out[a] as { x: number; y: number };
        const pb = out[b] as { x: number; y: number };
        const ca = cards[a] as CardSize;
        const cb = cards[b] as CardSize;
        const sepX = pa.x + ca.w + 24 <= pb.x || pb.x + cb.w + 24 <= pa.x;
        if (sepX) continue;
        const lower = pa.y <= pb.y ? b : a;
        const upper = lower === b ? a : b;
        const pu = out[upper] as { x: number; y: number };
        const pl = out[lower] as { x: number; y: number };
        const need = pu.y + (cards[upper] as CardSize).h + GAP_Y;
        if (pl.y < need) {
          out[lower] = { x: pl.x, y: need };
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return out;
}

// where a plan's new files go: a band above everything that's already on the map, callers on the left.
// files we've seen before keep the position they have, same stability rule as the rest.
export function placePlan(graph: Graph, cards: Record<string, CardSize>, cached: Positions): Positions {
  const files = Object.keys(cards).sort();
  const out: Positions = {};
  const fresh: string[] = [];
  for (const f of files) {
    const p = cached[f];
    if (p) out[f] = p;
    else fresh.push(f);
  }
  if (!fresh.length) return out;

  let minY = Infinity;
  let minX = Infinity;
  for (const f of Object.keys(out)) {
    const p = out[f] as { x: number; y: number };
    minY = Math.min(minY, p.y);
    minX = Math.min(minX, p.x);
  }
  if (!Number.isFinite(minY)) {
    minY = 0;
    minX = 0;
  }
  const bandH = Math.max(...fresh.map((f) => (cards[f] as CardSize).h));
  const y = minY - bandH - GAP_Y * 2;

  // callers first: files nothing else in the band imports come first
  const inBand = new Set(fresh);
  const incoming = new Map<string, number>(fresh.map((f) => [f, 0]));
  for (const e of graph.fedges) {
    if (inBand.has(e.from) && inBand.has(e.to) && e.from !== e.to) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }
  fresh.sort((a, b) => (incoming.get(a) ?? 0) - (incoming.get(b) ?? 0) || a.localeCompare(b));
  let x = minX;
  for (const f of fresh) {
    out[f] = { x, y };
    x += (cards[f] as CardSize).w + GAP_X;
  }
  return out;
}
