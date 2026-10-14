import type { Block, Edge, Graph } from '@blueprint/core/types';
import { L, allCards, type CardSize, type Positions } from '@blueprint/core/layout';

// the map page. one world element, moved with a css transform. the server owns where files sit,
// this file draws them and never moves anything on its own.

interface CheckEdge {
  from: string;
  to: string;
  callText: string;
  source: 'parser' | 'claim';
  check: 'confirmed' | 'missing' | 'unplanned';
  note?: string;
}
type ReviewState = 'drafting' | 'ready' | 'approved' | 'changes';
interface PlanState {
  id: string;
  title: string;
  state: 'proposed' | 'applied';
  review: { state: ReviewState; note?: string };
  planGraph: Graph;
  appliedGraph: Graph;
  positions: Positions;
  check: {
    summary: { confirmed: number; missing: number; unplanned: number; planned: number };
    edges: CheckEdge[];
    blocks: { missing: string[]; extra: string[] };
  };
}
interface State {
  rev: number;
  graph: Graph;
  positions: Positions;
  plans: Array<{ id: string; title: string; review: ReviewState }>;
  plan: PlanState | null;
}
type Mode = 'current' | 'plan' | 'applied';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface BlockPos extends Box {
  file: string;
  shown: number;
  el: HTMLElement | null;
  filled: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const KW = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|\b(import|from|function|const|let|var|return|if|else|throw|new|class|async|await|export|default|for|of|in|type|interface|enum|private|public|protected|readonly|static|extends|implements|constructor|declare|namespace|void|this)\b|\b(\d+(?:\.\d+)?)\b/g;
function hl(s: string): string {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(KW)) {
    const at = m.index ?? 0;
    out += esc(s.slice(last, at));
    const cls = m[1] ? 'bp-cm' : m[2] ? 'bp-st' : m[3] ? 'bp-kw' : 'bp-nu';
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = at + m[0].length;
  }
  return out + esc(s.slice(last));
}

const world = $('bp-world');
const vp = $('bp-vp');

let state: State | null = null;
let mode: Mode = 'current';
// scope: auto picks focus on big projects that have changes, whole otherwise. you can override it.
type Scope = 'auto' | 'focus' | 'all';
let scope: Scope = 'auto';
const FOCUS_ABOVE = 60;
let planChoice: string | null = null; // picker choice, null means the newest plan
let modeChosen = false; // once you pick a view, a new push doesn't switch it under you

// the graph and positions for the active view
function view(): { graph: Graph; positions: Positions } {
  const s = state as State;
  if (s.plan && mode === 'plan') return { graph: s.plan.planGraph, positions: s.plan.positions };
  if (s.plan && mode === 'applied') return { graph: s.plan.appliedGraph, positions: s.plan.positions };
  return { graph: s.graph, positions: s.positions };
}
let cards: Record<string, CardSize> = {};
let cardBox: Record<string, Box> = {};
const blockPos = new Map<string, BlockPos>();
let sel: string | null = null;
let moved = false;
// once you've panned or zoomed, resizes stop re-fitting the map
let touched = false;

/* camera */
const cam = { x: 0, y: 0, s: 0.35 };
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let raf = 0;

function levelName(s: number): string {
  return s < 0.5 ? 'Project map' : s < 0.95 ? 'File' : 'Code, line for line';
}
function apply(): void {
  world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.s})`;
  const map = cam.s < 0.5;
  world.classList.toggle('bp-map', map);
  world.classList.toggle('bp-code', !map);
  $('bp-lvl').textContent = levelName(cam.s);
  scheduleFill();
}
function animateTo(t: { x: number; y: number; s: number }, ms: number): void {
  cancelAnimationFrame(raf);
  if (reduce || !ms) {
    Object.assign(cam, t);
    apply();
    return;
  }
  const a = { ...cam };
  const t0 = performance.now();
  const step = (now: number) => {
    let k = Math.min(1, (now - t0) / ms);
    k = 1 - Math.pow(1 - k, 3);
    cam.s = a.s * Math.pow(t.s / a.s, k); // geometric, so zoom feels even
    cam.x = a.x + (t.x - a.x) * k;
    cam.y = a.y + (t.y - a.y) * k;
    apply();
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
function rectCam(r: Box, pad: number, max = 1.5) {
  const vw = vp.clientWidth;
  const vh = vp.clientHeight;
  const s = Math.max(0.12, Math.min(max, vw / (r.w + pad * 2), vh / (r.h + pad * 2)));
  return { s, x: vw / 2 - (r.x + r.w / 2) * s, y: vh / 2 - (r.y + r.h / 2) * s };
}
function bounds(): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of Object.values(cardBox)) {
    x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
  }
  // the "New files" label floats above the band, so leave room for it
  if (mode === 'plan' && Number.isFinite(y0)) y0 -= 110;
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 800, h: 600 };
}
const fitAll = (ms: number) => animateTo(rectCam(bounds(), 30, 1), ms);
function zoomBy(f: number, cx = vp.clientWidth / 2, cy = vp.clientHeight / 2): void {
  const s = Math.min(2.2, Math.max(0.12, cam.s * f));
  const k = s / cam.s;
  cam.x = cx - (cx - cam.x) * k;
  cam.y = cy - (cy - cam.y) * k;
  cam.s = s;
  apply();
}
const goFile = (f: string) => {
  const c = cardBox[f];
  if (c) animateTo(rectCam(c, 30, 1.5), 700);
};
const goBlock = (id: string) => {
  const p = blockPos.get(id);
  if (p) animateTo(rectCam(p, 80, 1.8), 700);
  select(id);
};

vp.addEventListener('wheel', (e) => {
  e.preventDefault();
  touched = true;
  cancelAnimationFrame(raf);
  if (e.ctrlKey || e.metaKey) {
    const r = vp.getBoundingClientRect();
    zoomBy(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
  } else {
    cam.x -= e.deltaX;
    cam.y -= e.deltaY;
    apply();
  }
}, { passive: false });
let drag: { x: number; y: number; cx: number; cy: number } | null = null;
vp.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('.bp-tools')) return;
  drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
  moved = false;
  touched = true;
  $('bp-hint').hidden = true;
  cancelAnimationFrame(raf);
});
vp.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
    moved = true;
    // only capture once it's really a drag, or the capture eats clicks on blocks and files
    vp.setPointerCapture(e.pointerId);
    vp.classList.add('drag');
  }
  if (!moved) return;
  cam.x = drag.cx + dx;
  cam.y = drag.cy + dy;
  apply();
});
const endDrag = () => {
  drag = null;
  vp.classList.remove('drag');
  // click fires right after pointerup, so clear the flag a tick later
  setTimeout(() => (moved = false), 0);
};
vp.addEventListener('pointerup', endDrag);
vp.addEventListener('pointercancel', endDrag);
$('bp-zi').onclick = () => { touched = true; cancelAnimationFrame(raf); zoomBy(1.4); };
$('bp-zo').onclick = () => { touched = true; cancelAnimationFrame(raf); zoomBy(1 / 1.4); };
$('bp-fit').onclick = () => { touched = false; fitAll(500); };
vp.addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') zoomBy(1.25);
  else if (e.key === '-') zoomBy(0.8);
  else if (e.key === '0') fitAll(400);
  else if (e.key === 'Escape') select(null);
});

/* drawing */
const fileName = (f: string) => f.split('/').pop() ?? f;
const fileDir = (f: string) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '');
const tagFor = (s: Block['status']) => (s === 'new' ? ['bp-t-new', 'new'] : s === 'mod' ? ['bp-t-mod', 'modified'] : s === 'del' ? ['bp-t-del', 'deleted'] : null);
const shortName = (id: string) => id.split('::')[1] ?? id;

function counts(f: string): { mod: number; nw: number; del: number } {
  let mod = 0, nw = 0, del = 0;
  for (const b of Object.values(state ? view().graph.blocks : {})) {
    if (b.file !== f || b.kind === 'imports') continue;
    if (b.status === 'mod') mod++;
    else if (b.status === 'new') nw++;
    else if (b.status === 'del') del++;
  }
  return { mod, nw, del };
}

// files that are unchanged but called into by the proposed code, for the plan view badges
function usedByNewCode(g: Graph): Set<string> {
  const out = new Set<string>();
  if (mode !== 'plan') return out;
  for (const e of g.edges) {
    if (e.status !== 'new' && e.source !== 'claim') continue;
    const f = g.blocks[e.to]?.file;
    if (f && g.fstat[f] === 'same') out.add(f);
  }
  return out;
}

// changed files plus every file one arrow away. null when nothing changed, so there is nothing to focus on.
function focusSet(g: Graph): Set<string> | null {
  const core = new Set(Object.keys(g.fstat).filter((f) => g.fstat[f] !== 'same'));
  if (!core.size) return null;
  const keep = new Set(core);
  for (const e of g.fedges) {
    if (core.has(e.from)) keep.add(e.to);
    if (core.has(e.to)) keep.add(e.from);
  }
  for (const e of g.edges) {
    const f = g.blocks[e.from]?.file;
    const t = g.blocks[e.to]?.file;
    if (f && t && core.has(f)) keep.add(t);
    if (f && t && core.has(t)) keep.add(f);
  }
  return keep;
}

// which files are drawn right now
function shownFiles(g: Graph): Set<string> | null {
  const focus = focusSet(g);
  if (!focus) return null;
  const big = Object.keys(g.fstat).length > FOCUS_ABOVE;
  const useFocus = scope === 'focus' || (scope === 'auto' && big);
  return useFocus ? focus : null;
}

function buildWorld(prevSigs: Map<string, string> | null): void {
  const g = view().graph;
  const usedByNew = usedByNewCode(g);
  world.classList.remove('bp-mode-current', 'bp-mode-plan', 'bp-mode-applied');
  world.classList.add(`bp-mode-${mode}`);
  cards = allCards(g);
  cardBox = {};
  blockPos.clear();
  const only = shownFiles(g);
  let html = '';
  for (const f of Object.keys(cards).sort()) {
    if (only && !only.has(f)) continue;
    const card = cards[f] as CardSize;
    const p = view().positions[f] ?? { x: 0, y: 0 };
    cardBox[f] = { x: p.x, y: p.y, w: card.w, h: card.h };
    const st = g.fstat[f] ?? 'same';
    const c = counts(f);
    const badges: string[] = [];
    if (st === 'new') {
      const n = Object.values(g.blocks).filter((b) => b.file === f && b.kind !== 'imports').length;
      badges.push(`<span class="bp-badge bp-b-new">NEW${mode === 'plan' ? '  ' + n + ' blocks' : ''}</span>`);
    } else if (st === 'del') badges.push(`<span class="bp-badge bp-b-del">DELETED</span>`);
    else if (st === 'mod') {
      // a brand new block inside an existing file is a "slot", the rest are edits to what was there
      const slots = c.nw;
      const edits = c.mod + c.del;
      const parts = [edits ? `~${edits} modified` : '', slots ? `+${slots} new slot${slots === 1 ? '' : 's'}` : ''].filter(Boolean);
      badges.push(`<span class="bp-badge bp-b-mod">${parts.length ? parts.join('  ') : '~1 changed'}</span>`);
    } else if (usedByNew.has(f)) badges.push(`<span class="bp-badge bp-b-use">used by new code</span>`);
    html += `<div class="bp-file bp-s-${st}" data-f="${esc(f)}" style="left:${p.x}px;top:${p.y}px;width:${card.w}px;height:${card.h}px">` +
      `<div class="bp-fh"><span class="bp-fn"><span class="bp-dir">${esc(fileDir(f))}</span>${esc(fileName(f))}</span><span class="bp-row">${badges.join('')}</span></div></div>`;
    for (const bx of card.blocks) {
      const b = g.blocks[bx.id] as Block;
      const x = p.x + bx.x;
      const y = p.y + bx.y;
      blockPos.set(b.id, { x, y, w: bx.w, h: bx.h, file: f, shown: bx.shown, el: null, filled: false });
      const tag = tagFor(b.status);
      if (tag && b.status === 'new' && mode === 'plan') tag[1] = 'new (proposed)';
      html += `<div class="bp-blk bp-k-${b.kind} bp-s-${b.status}" tabindex="0" data-id="${esc(b.id)}" style="left:${x}px;top:${y}px;width:${bx.w}px;height:${bx.h}px">` +
        `<div class="bp-bh"><span class="bp-bk">${b.kind}</span><span class="bp-bn">${esc(b.name)}</span>${tag ? `<span class="bp-tag ${tag[0]}">${tag[1]}</span>` : ''}</div><div class="bp-bb"></div></div>`;
    }
  }
  if (mode === 'plan') {
    const fresh = Object.keys(cards).filter((f) => g.fstat[f] === 'new').map((f) => cardBox[f] as Box);
    if (fresh.length) {
      const x = Math.min(...fresh.map((b) => b.x));
      const y = Math.min(...fresh.map((b) => b.y));
      html += `<div class="bp-band" style="left:${x}px;top:${y - 84}px">New files, above the map</div>`;
    }
  }
  html += '<svg class="bp-arrows bp-fedges" id="bp-fsvg" width="1" height="1"></svg><svg class="bp-arrows bp-bedges" id="bp-bsvg" width="1" height="1"></svg>';
  world.innerHTML = html;
  world.querySelectorAll<HTMLElement>('.bp-blk').forEach((el) => {
    const p = blockPos.get(el.dataset.id as string);
    if (p) p.el = el;
  });
  // blocks whose lines changed since the last push get a short pulse
  if (prevSigs) {
    for (const [id, p] of blockPos) {
      const prev = prevSigs.get(id);
      if (prev !== undefined && prev !== sigOf(g.blocks[id] as Block)) p.el?.classList.add('bp-pulse');
    }
  }
  drawFileEdges();
  bedgesBuilt = false;
  if (cam.s >= 0.5) drawBlockEdges();
  applySelection();
  scheduleFill();
}

const sigOf = (b: Block) => `${b.status}:${b.lines.length}:${b.lines.map((l) => l.d + l.t).join('\n')}`;

/* lazy code lines: only blocks in view at code zoom get their lines */
let fillQueued = false;
function scheduleFill(): void {
  if (fillQueued) return;
  fillQueued = true;
  requestAnimationFrame(() => {
    fillQueued = false;
    fillVisible();
  });
}
function fillVisible(): void {
  if (!state || cam.s < 0.5) return;
  const x0 = -cam.x / cam.s - 200;
  const y0 = -cam.y / cam.s - 200;
  const x1 = x0 + vp.clientWidth / cam.s + 400;
  const y1 = y0 + vp.clientHeight / cam.s + 400;
  for (const [id, p] of blockPos) {
    if (p.filled || !p.el) continue;
    if (p.x > x1 || p.x + p.w < x0 || p.y > y1 || p.y + p.h < y0) continue;
    const b = view().graph.blocks[id] as Block;
    const rows = b.lines.slice(0, L.MAXLINES).map((l) => {
      const num = l.d === '-' ? l.o : l.n;
      const d = l.d === '+' ? 'bp-d-p' : l.d === '-' ? 'bp-d-m' : 'bp-d-s';
      return `<div class="bp-ln ${d}"><span class="bp-g">${num ?? ''}</span><span class="bp-c">${hl(l.t)}</span></div>`;
    });
    if (b.lines.length > L.MAXLINES) rows.push(`<div class="bp-more">${b.lines.length - L.MAXLINES} more lines</div>`);
    (p.el.querySelector('.bp-bb') as HTMLElement).innerHTML = rows.join('');
    p.filled = true;
  }
}

/* arrows */
function lineY(id: string, line: number | undefined, useOld: boolean): number {
  const p = blockPos.get(id) as BlockPos;
  const b = view().graph.blocks[id] as Block;
  let idx = -1;
  if (line !== undefined) idx = b.lines.findIndex((l) => (useOld ? l.o : l.n) === line);
  if (idx < 0 || idx >= p.shown) return p.y + L.BHH / 2;
  return p.y + L.BHH + 6 + idx * L.LH + 7;
}

function route(a: BlockPos, t: BlockPos, y1: number, y2: number): { d: string; x: number; y: number } {
  if (t.x >= a.x + a.w) {
    const x1 = a.x + a.w, x2 = t.x, dx = Math.max(40, (x2 - x1) / 2.4);
    return { d: `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2 - 4} ${y2}`, x: x1, y: y1 };
  }
  if (t.x + t.w <= a.x) {
    const x1 = a.x, x2 = t.x + t.w, dx = Math.max(40, (x1 - x2) / 2.4);
    return { d: `M${x1} ${y1} C${x1 - dx} ${y1} ${x2 + dx} ${y2} ${x2 + 4} ${y2}`, x: x1, y: y1 };
  }
  // same column: bow out to the right
  const x1 = a.x + a.w, x2 = t.x + t.w, o = Math.max(x1, x2) + 50;
  return { d: `M${x1} ${y1} C${o} ${y1} ${o} ${y2} ${x2 + 4} ${y2}`, x: x1, y: y1 };
}

const DEFS = '<defs><marker id="bp-mb" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path class="bp-mk-b" d="M0 0L8 4L0 8z"/></marker>' +
  '<marker id="bp-mn" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path class="bp-mk-n" d="M0 0L8 4L0 8z"/></marker>' +
  '<marker id="bp-mg" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path class="bp-mk-g" d="M0 0L8 4L0 8z"/></marker>' +
  '<marker id="bp-mh" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path class="bp-mk-h" d="M1 1L7 4L1 7z"/></marker>' +
  '<marker id="bp-ma" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path class="bp-mk-a" d="M0 0L8 4L0 8z"/></marker></defs>';

let bedgesBuilt = false;
function drawBlockEdges(): void {
  if (!state) return;
  const svg = $('bp-bsvg') as unknown as SVGSVGElement;
  let s = DEFS;
  for (const e of view().graph.edges) {
    const a = blockPos.get(e.from);
    const t = blockPos.get(e.to);
    if (!a || !t) continue;
    const gone = e.status === 'del';
    const y1 = lineY(e.from, e.callLine, gone);
    const y2 = lineY(e.to, e.targetLine, gone);
    const r = route(a, t, y1, y2);
    // how this arrow should look. parser facts are solid, anything not on disk yet is dashed,
    // claims are dashed with a hollow head so nobody reads them as parsed.
    let k = gone ? 'bp-gone' : e.status === 'new' ? 'bp-new' : '';
    let mk = gone ? 'bp-mg' : e.status === 'new' ? 'bp-mn' : 'bp-mb';
    if (mode === 'plan' && e.source === 'claim') { k = 'bp-claim'; mk = 'bp-mh'; }
    else if (mode === 'plan' && e.status === 'new') { k = 'bp-new bp-proposed'; }
    if (mode === 'applied') {
      if (e.check === 'missing') { k = 'bp-missing'; mk = 'bp-mg'; }
      else if (e.check === 'unplanned') { k = 'bp-unplanned'; mk = 'bp-ma'; }
      else if (e.check === 'confirmed') { k = 'bp-new bp-confirmed'; mk = 'bp-mn'; }
    }
    s += `<path class="bp-ed ${k}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${r.d}" marker-end="url(#${mk})"/>` +
      `<circle class="bp-edot ${k}" cx="${r.x}" cy="${r.y}" r="3.4"/>`;
    if (mode === 'applied' && e.check === 'missing') {
      s += `<text class="bp-elab" x="${r.x + 14}" y="${r.y - 8}">not in the code</text>`;
    }
  }
  svg.innerHTML = s;
  bedgesBuilt = true;
}

function drawFileEdges(): void {
  if (!state) return;
  const svg = $('bp-fsvg') as unknown as SVGSVGElement;
  let s = DEFS.replace(/id="bp-m/g, 'id="bp-fm').replace(/#bp-m/g, '#bp-fm');
  for (const fe of view().graph.fedges) {
    const a = cardBox[fe.from];
    const t = cardBox[fe.to];
    if (!a || !t) continue;
    const ay = a.y + a.h / 2, ty = t.y + t.h / 2;
    let d: string;
    if (t.x >= a.x + a.w) {
      const x1 = a.x + a.w, x2 = t.x - 4;
      const y1 = Math.min(Math.max(ay, a.y + 60), a.y + a.h - 20);
      const y2 = Math.min(Math.max(ty, t.y + 60), t.y + t.h - 20);
      const dx = (x2 - x1) / 2.2;
      d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
    } else if (t.x + t.w <= a.x) {
      const x1 = a.x, x2 = t.x + t.w + 4;
      const y1 = Math.min(Math.max(ay, a.y + 60), a.y + a.h - 20);
      const y2 = Math.min(Math.max(ty, t.y + 60), t.y + t.h - 20);
      const dx = (x1 - x2) / 2.2;
      d = `M${x1} ${y1} C${x1 - dx} ${y1} ${x2 + dx} ${y2} ${x2} ${y2}`;
    } else {
      // overlapping columns: go over or under
      const down = t.y > a.y;
      const x = Math.max(a.x, t.x) + 140;
      const y1 = down ? a.y + a.h : a.y;
      const y2 = down ? t.y - 4 : t.y + t.h + 4;
      d = `M${x} ${y1} L${x} ${y2}`;
    }
    const k = fe.status === 'del' ? 'bp-gone' : fe.status === 'new' ? 'bp-new' : '';
    const mk = fe.status === 'del' ? 'bp-fmg' : fe.status === 'new' ? 'bp-fmn' : 'bp-fmb';
    s += `<path class="bp-ed ${k}" d="${d}" marker-end="url(#${mk})"/>`;
  }
  svg.innerHTML = s;
}

/* selection and inspector */
function applySelection(): void {
  const g = state ? view().graph : undefined;
  const related = new Set<string>();
  if (sel && g) {
    related.add(sel);
    for (const e of g.edges) {
      if (e.from === sel) related.add(e.to);
      if (e.to === sel) related.add(e.from);
    }
  }
  for (const [id, p] of blockPos) {
    p.el?.classList.toggle('bp-sel', id === sel);
    p.el?.classList.toggle('bp-dim', !!sel && !related.has(id));
  }
  world.querySelectorAll('#bp-bsvg .bp-ed').forEach((el) => {
    const f = el.getAttribute('data-from');
    const t = el.getAttribute('data-to');
    el.classList.toggle('bp-dim', !!sel && f !== sel && t !== sel);
  });
}

function select(id: string | null): void {
  sel = id && blockPos.has(id) ? id : null;
  applySelection();
  inspect();
}

function firstLineOf(b: Block): number {
  for (const l of b.lines) if (l.n !== null) return l.n;
  for (const l of b.lines) if (l.o !== null) return l.o;
  return 1;
}
const lineRange = (b: Block): string => {
  const ns = b.lines.map((l) => l.n).filter((n): n is number => n !== null);
  return ns.length ? `${Math.min(...ns)}-${Math.max(...ns)}` : String(firstLineOf(b));
};

function inspect(): void {
  const el = $('bp-insp');
  if (!sel || !state) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  const g = view().graph;
  const b = g.blocks[sel] as Block;
  const by = g.edges.filter((e) => e.to === sel && e.status !== 'del');
  const uses = g.edges.filter((e) => e.from === sel && e.status !== 'del');
  const MAX = 5;
  const chip = (e: Edge, dir: 'by' | 'uses') => {
    const other = dir === 'by' ? e.from : e.to;
    const ob = g.blocks[other];
    const line = dir === 'by' ? e.callLine : e.targetLine;
    return `<button class="bp-chip ${e.status === 'new' ? 'bp-nw' : ''}" data-go="${esc(other)}"><b>${esc(shortName(other))}</b> <i>${line ? `L${line} ` : ''}${esc(ob?.file ?? '')}</i></button>`;
  };
  const list = (es: Edge[], dir: 'by' | 'uses') =>
    es.slice(0, MAX).map((e) => chip(e, dir)).join('') + (es.length > MAX ? `<span class="bp-none">and ${es.length - MAX} more</span>` : '');
  const grp = (title: string, es: Edge[], dir: 'by' | 'uses') => (es.length ? `<div class="bp-grp"><h4>${title}</h4>${list(es, dir)}</div>` : '');
  const st = b.status === 'same' ? '' : `<span class="bp-tag bp-t-${b.status}">${b.status === 'mod' ? 'modified' : b.status === 'new' ? 'new' : 'deleted'}</span>`;
  el.innerHTML =
    `<div class="bp-ih"><span class="bp-nm">${esc(b.name)}</span>${st}<button class="bp-x" id="bp-insp-x" aria-label="Close">x</button></div>` +
    `<div class="bp-loc">${esc(b.file)} : ${lineRange(b)}</div>` +
    (grp('Used by', by, 'by') + grp('Uses', uses, 'uses') || '<div class="bp-none">Nothing calls this and it calls nothing here.</div>');
  el.querySelectorAll<HTMLElement>('[data-go]').forEach((c) => (c.onclick = () => goBlock(c.dataset.go as string)));
  $('bp-insp-x').onclick = () => select(null);
}

function planPicker(): string {
  if (!state || state.plans.length < 2 || isSnapshot) return '';
  const cur = state.plan?.id;
  return `<div class="bp-grp"><h4>Plan</h4><select id="bp-picker" class="bp-select">${state.plans
    .map((p) => `<option value="${esc(p.id)}"${p.id === cur ? ' selected' : ''}>${esc(p.title)}</option>`)
    .join('')}</select></div>`;
}

function wireReview(el: HTMLElement): void {
  const pick = el.querySelector<HTMLSelectElement>('#bp-picker');
  if (pick) pick.onchange = () => { planChoice = pick.value; void load().catch(() => {}); };
}

function renderChanges(): void {
  const el = $('bp-card');
  const legend = $('bp-legend');
  if (!state) return;
  const plan = state.plan;
  let h = '';
  legend.hidden = true;

  if (plan && mode === 'plan') {
    const r = plan.review;
    const status =
      r.state === 'ready' ? 'Ready for your review. Say go in chat, or tell Claude what to change.'
      : r.state === 'approved' ? 'Approved'
      : r.state === 'changes' ? `Changes requested${r.note ? `: ${esc(r.note)}` : ''}`
      : 'Proposed';
    const cls = r.state === 'approved' ? ' bp-good' : r.state === 'changes' ? ' bp-bad' : '';
    h += `<div class="bp-cardhead${cls}"><b>${esc(plan.title)}</b><span>${status}</span></div>`;
    h += '<div class="bp-legendrow"><span class="bp-lg bp-lg-solid"></span>in the code <span class="bp-lg bp-lg-dash"></span>proposed <span class="bp-lg bp-lg-hollow"></span>claim</div>';
  } else if (plan && mode === 'applied') {
    const c = plan.check;
    const bad = c.edges.filter((e) => e.check !== 'confirmed');
    const label = (e: CheckEdge) => `${shortName(e.from)} to ${shortName(e.to)}`;
    const cls = bad.length || c.blocks.missing.length ? ' bp-bad' : ' bp-good';
    h += `<div class="bp-cardhead${cls}"><b>${c.summary.confirmed} of ${c.summary.planned} planned arrows confirmed</b><span>${esc(plan.title)}</span></div>`;
    if (plan.state === 'proposed') h += '<div class="bp-note">Not applied yet, so nothing can be confirmed.</div>';
    const shown = bad.slice(0, 3);
    if (shown.length) {
      h += '<ul class="bp-probs">' + shown.map((e) => `<li><span class="${e.check === 'missing' ? 'bp-miss' : 'bp-unpl'}">${e.check === 'missing' ? 'not in the code' : 'unplanned'}</span> ${esc(label(e))}</li>`).join('') +
        (bad.length > 3 ? `<li class="bp-none">and ${bad.length - 3} more, ask Claude for the full list</li>` : '') + '</ul>';
    }
    h += '<div class="bp-legendrow"><span class="bp-lg bp-lg-conf"></span>confirmed <span class="bp-lg bp-lg-miss"></span>not in the code <span class="bp-lg bp-lg-unpl"></span>unplanned</div>';
  }
  // more than one plan: a picker. otherwise nothing extra
  if (plan && mode !== 'current') h += planPicker();
  el.hidden = !h;
  el.innerHTML = h;
  wireReview(el);
}

function renderMeta(): void {
  if (!state) return;
  const g = state.graph;
  const m = g.meta;
  const v = view().graph;
  // the counts live in chat. the window only warns about things that make the map less trustworthy.
  $('bp-meta').textContent = m?.typeErrors ? `${m.typeErrors} type errors, some arrows may be missing` : '';
  ($('bp-empty') as HTMLElement).hidden = Object.keys(g.fstat).length > 0 || !!state.plan;
  // mode switch only exists when there is a plan to look at
  const scopeEl = $('bp-scope');
  const focus = focusSet(v);
  const total = Object.keys(v.fstat).length;
  // only worth a control on a big project. small ones just open whole.
  scopeEl.hidden = !focus || total <= FOCUS_ABOVE;
  if (focus) {
    const on = shownFiles(v) ? 'focus' : 'all';
    scopeEl.querySelectorAll<HTMLElement>('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === on));
    const note = shownFiles(v) ? `showing ${focus.size} of ${total} files` : '';
    $('bp-scopenote').textContent = note;
  }
  const modes = $('bp-modes');
  modes.hidden = !state.plan;
  modes.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
  $('bp-planname').hidden = true;
}

function setMode(m: Mode, chosen = true): void {
  if (!state) return;
  if (m !== 'current' && !state.plan) m = 'current';
  if (m === mode) return;
  mode = m;
  if (chosen) modeChosen = true;
  if (sel && !view().graph.blocks[sel]) sel = null;
  buildWorld(null);
  renderMeta();
  renderChanges();
  inspect();
  // the plan band sits above the old bounds, so frame it again
  if (!touched) fitAll(400);
}

/* events and updates */
world.addEventListener('click', (e) => {
  if (moved) return;
  const b = (e.target as HTMLElement).closest<HTMLElement>('.bp-blk');
  if (b) {
    const id = b.dataset.id as string;
    if (cam.s < 0.5) {
      const p = blockPos.get(id);
      if (p) goFile(p.file);
    }
    select(id);
    return;
  }
  if (!(e.target as HTMLElement).closest('.bp-file')) select(null);
});
world.addEventListener('keydown', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.bp-blk');
  if (b && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    goBlock(b.dataset.id as string);
  }
});
world.addEventListener('dblclick', (e) => {
  const f = (e.target as HTMLElement).closest<HTMLElement>('.bp-file');
  if (f) goFile(f.dataset.f as string);
});
vp.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  // blocks are siblings of file cards in the world, not children, so check both
  if (!moved && !t.closest('.bp-file') && !t.closest('.bp-blk') && !t.closest('.bp-tools')) select(null);
});
// a snapshot has its data baked into the page and no server behind it
const embedded = document.getElementById('bp-data');
const isSnapshot = embedded !== null;

let first = true;
async function load(): Promise<void> {
  let next: State;
  if (embedded) next = JSON.parse(embedded.textContent ?? '') as State;
  else {
    const r = await fetch(planChoice ? `/api/state?plan=${encodeURIComponent(planChoice)}` : '/api/state');
    if (!r.ok) throw new Error(`state ${r.status}`);
    next = (await r.json()) as State;
  }
  const prev = state;
  const prevSigs = prev ? new Map(Object.entries(prev.graph.blocks).map(([id, b]) => [id, sigOf(b)])) : null;
  state = next;
  if (!state.plan) mode = 'current';
  else if (!modeChosen && (!prev || !prev.plan || prev.plan.id !== state.plan.id)) {
    // a plan just showed up: lead with it, applied plans lead with the check
    mode = state.plan.state === 'applied' ? 'applied' : 'plan';
  }
  buildWorld(prevSigs);
  renderMeta();
  renderChanges();
  inspect();
  if (first) {
    first = false;
    fitAll(0);
  }
}

function connect(): void {
  const live = $('bp-live');
  if (isSnapshot) {
    const when = state?.graph.meta?.parsedAt ? new Date(state.graph.meta.parsedAt).toLocaleString() : '';
    live.textContent = when ? `snapshot, ${when}` : 'snapshot';
    live.className = 'bp-live';
    return;
  }
  const es = new EventSource('/api/events');
  es.addEventListener('rev', (ev) => {
    const rev = (JSON.parse((ev as MessageEvent).data) as { rev: number }).rev;
    live.textContent = 'watching';
    live.className = 'bp-live on';
    // the first load is already in flight when this first event lands, so only react once we have state
    if (state && rev !== state.rev) void load().catch(() => {});
  });
  es.onerror = () => {
    live.textContent = 'disconnected';
    live.className = 'bp-live off';
  };
}

// block arrows are built the first time you're at code zoom after a push, then kept
setInterval(() => {
  if (cam.s >= 0.5 && state && !bedgesBuilt) drawBlockEdges();
}, 250);

/* theme */
function setTheme(t: 'light' | 'dark' | null): void {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try {
    if (t) localStorage.setItem('bp-theme', t);
    else localStorage.removeItem('bp-theme');
  } catch {
    // storage can be blocked, the theme just won't stick
  }
}
try {
  const t = localStorage.getItem('bp-theme');
  if (t === 'light' || t === 'dark') setTheme(t);
} catch {
  // ignore
}
$('bp-theme').onclick = () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  setTheme(dark ? 'light' : 'dark');
};
$('bp-scope').querySelectorAll<HTMLElement>('[data-s]').forEach((b) => {
  b.onclick = () => {
    scope = b.dataset.s === 'focus' ? 'focus' : 'all';
    touched = false;
    buildWorld(null);
    renderMeta();
    fitAll(400);
  };
});
$('bp-modes').querySelectorAll<HTMLElement>('[data-m]').forEach((b) => {
  b.onclick = () => setMode(b.dataset.m as Mode);
});
new ResizeObserver(() => {
  if (!touched && state) fitAll(0);
  scheduleFill();
}).observe(vp);

apply();
connect();
void load().then(() => { if (isSnapshot) connect(); }).catch((e: unknown) => {
  $('bp-live').textContent = 'could not load';
  $('bp-live').className = 'bp-live off';
  $('bp-meta').textContent = e instanceof Error ? e.message : String(e);
});
