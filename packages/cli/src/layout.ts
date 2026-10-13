import fs from 'node:fs';
import path from 'node:path';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { Graph } from '@blueprint/core';
import type { CardSize, Positions } from '@blueprint/core/layout';

// where whole file cards sit on the map.
// stability rule (CONTEXT principle 3): a re-parse only places new files and never moves
// existing ones. positions are cached in .blueprint/layout.json until someone asks to re-layout.

const FILE = (root: string) => path.join(root, '.blueprint', 'layout.json');

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
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, positions }, null, 1));
  fs.renameSync(tmp, f);
}

const GAP_X = 180;
const GAP_Y = 80;

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
  return out;
}
