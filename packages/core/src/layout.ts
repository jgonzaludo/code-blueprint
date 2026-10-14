// sizes for file cards and the blocks inside them. pure, no typescript import, so the browser
// bundle can use it too. positions of whole files come from the server (elk plus a cache).
import type { Block, Graph } from './types.js';

export const L = {
  COLW: 420, // block column width
  GAP: 72, // gap between columns, wide enough for arrows to run between them
  PAD: 16, // card padding
  FH: 112, // file header height, badges included
  BG: 18, // gap between stacked blocks
  LH: 14, // code line height
  BHH: 26, // block header height
  MAXLINES: 60, // longer blocks collapse with a "+N more lines" row
} as const;

export interface BlockBox {
  id: string;
  x: number; // relative to the card
  y: number;
  w: number;
  h: number;
  shown: number; // code lines drawn (the rest are collapsed)
}

export interface CardSize {
  file: string;
  w: number;
  h: number;
  blocks: BlockBox[];
}

export type Positions = Record<string, { x: number; y: number }>;

// first line number a block occupies, new numbering first. keeps source order stable.
const firstLine = (b: Block): number => {
  for (const l of b.lines) if (l.n !== null) return l.n;
  for (const l of b.lines) if (l.o !== null) return l.o;
  return 0;
};

export function blockHeight(b: Block): { h: number; shown: number } {
  const shown = Math.min(b.lines.length, L.MAXLINES);
  const extra = b.lines.length > L.MAXLINES ? 1 : 0;
  return { h: L.BHH + 6 + (shown + extra) * L.LH + 6, shown };
}

// blocks stack in columns, each next block goes under the shortest column
export function cardSize(graph: Graph, file: string): CardSize {
  const blocks = Object.values(graph.blocks)
    .filter((b) => b.file === file)
    .sort((a, b) => firstLine(a) - firstLine(b) || a.id.localeCompare(b.id));
  const cols = Math.max(1, Math.min(4, Math.ceil(blocks.length / 5)));
  const heights = new Array<number>(cols).fill(0);
  const out: BlockBox[] = [];
  for (const b of blocks) {
    let c = 0;
    for (let i = 1; i < cols; i++) if ((heights[i] as number) < (heights[c] as number)) c = i;
    const { h, shown } = blockHeight(b);
    out.push({ id: b.id, x: L.PAD + c * (L.COLW + L.GAP), y: L.FH + (heights[c] as number), w: L.COLW, h, shown });
    heights[c] = (heights[c] as number) + h + L.BG;
  }
  const tallest = Math.max(0, ...heights.map((h) => (h > 0 ? h - L.BG : 0)));
  return {
    file,
    w: L.PAD * 2 + cols * L.COLW + (cols - 1) * L.GAP,
    h: L.FH + tallest + L.PAD,
    blocks: out,
  };
}

export function allCards(graph: Graph): Record<string, CardSize> {
  const out: Record<string, CardSize> = {};
  for (const f of Object.keys(graph.fstat)) out[f] = cardSize(graph, f);
  return out;
}
