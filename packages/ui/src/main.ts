import type { Block, Edge, Graph } from '@blueprint/core/types';
import { L, allCards, type CardSize, type Positions } from '@blueprint/core/layout';

// the map page. one world element, moved with a css transform. the server owns where files sit,
// this file draws them and never moves anything on its own.

interface State {
  rev: number;
  graph: Graph;
  positions: Positions;
}

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
  for (const b of Object.values(state?.graph.blocks ?? {})) {
    if (b.file !== f || b.kind === 'imports') continue;
    if (b.status === 'mod') mod++;
    else if (b.status === 'new') nw++;
    else if (b.status === 'del') del++;
  }
  return { mod, nw, del };
}

function buildWorld(prevSigs: Map<string, string> | null): void {
  const g = (state as State).graph;
  cards = allCards(g);
  cardBox = {};
  blockPos.clear();
  let html = '';
  for (const f of Object.keys(cards).sort()) {
    const card = cards[f] as CardSize;
    const p = (state as State).positions[f] ?? { x: 0, y: 0 };
    cardBox[f] = { x: p.x, y: p.y, w: card.w, h: card.h };
    const st = g.fstat[f] ?? 'same';
    const c = counts(f);
    const badges: string[] = [];
    if (st === 'new') badges.push(`<span class="bp-badge bp-b-new">NEW</span>`);
    else if (st === 'del') badges.push(`<span class="bp-badge bp-b-del">DELETED</span>`);
    else if (st === 'mod') badges.push(`<span class="bp-badge bp-b-mod">~${c.mod + c.nw + c.del || 1} changed</span>`);
    html += `<div class="bp-file bp-s-${st}" data-f="${esc(f)}" style="left:${p.x}px;top:${p.y}px;width:${card.w}px;height:${card.h}px">` +
      `<div class="bp-fh"><span class="bp-fn"><span class="bp-dir">${esc(fileDir(f))}</span>${esc(fileName(f))}</span><span class="bp-row">${badges.join('')}</span></div></div>`;
    for (const bx of card.blocks) {
      const b = g.blocks[bx.id] as Block;
      const x = p.x + bx.x;
      const y = p.y + bx.y;
      blockPos.set(b.id, { x, y, w: bx.w, h: bx.h, file: f, shown: bx.shown, el: null, filled: false });
      const tag = tagFor(b.status);
      html += `<div class="bp-blk bp-k-${b.kind} bp-s-${b.status}" tabindex="0" data-id="${esc(b.id)}" style="left:${x}px;top:${y}px;width:${bx.w}px;height:${bx.h}px">` +
        `<div class="bp-bh"><span class="bp-bk">${b.kind}</span><span class="bp-bn">${esc(b.name)}</span>${tag ? `<span class="bp-tag ${tag[0]}">${tag[1]}</span>` : ''}</div><div class="bp-bb"></div></div>`;
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
    const b = (state as State).graph.blocks[id] as Block;
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
  const b = (state as State).graph.blocks[id] as Block;
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
  '<marker id="bp-mg" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path class="bp-mk-g" d="M0 0L8 4L0 8z"/></marker></defs>';

let bedgesBuilt = false;
function drawBlockEdges(): void {
  if (!state) return;
  const svg = $('bp-bsvg') as unknown as SVGSVGElement;
  let s = DEFS;
  for (const e of state.graph.edges) {
    const a = blockPos.get(e.from);
    const t = blockPos.get(e.to);
    if (!a || !t) continue;
    const gone = e.status === 'del';
    const y1 = lineY(e.from, e.callLine, gone);
    const y2 = lineY(e.to, e.targetLine, gone);
    const r = route(a, t, y1, y2);
    const k = gone ? 'bp-gone' : e.status === 'new' ? 'bp-new' : '';
    const mk = gone ? 'bp-mg' : e.status === 'new' ? 'bp-mn' : 'bp-mb';
    s += `<path class="bp-ed ${k}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${r.d}" marker-end="url(#${mk})"/>` +
      `<circle class="bp-edot ${k}" cx="${r.x}" cy="${r.y}" r="3.4"/>`;
  }
  svg.innerHTML = s;
  bedgesBuilt = true;
}

function drawFileEdges(): void {
  if (!state) return;
  const svg = $('bp-fsvg') as unknown as SVGSVGElement;
  let s = DEFS.replace(/id="bp-m/g, 'id="bp-fm').replace(/#bp-m/g, '#bp-fm');
  for (const fe of state.graph.fedges) {
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
  const g = state?.graph;
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
    el.innerHTML = '<p class="bp-ph">Select a block to see what calls it and what it calls. Zoom out for the project, zoom in to read every line.</p>';
    return;
  }
  const g = state.graph;
  const b = g.blocks[sel] as Block;
  const by = g.edges.filter((e) => e.to === sel && e.status !== 'del');
  const uses = g.edges.filter((e) => e.from === sel && e.status !== 'del');
  const chip = (e: Edge, dir: 'by' | 'uses') => {
    const other = dir === 'by' ? e.from : e.to;
    const ob = g.blocks[other];
    const line = dir === 'by' ? e.callLine : e.targetLine;
    return `<button class="bp-chip ${e.status === 'new' ? 'bp-nw' : ''}" data-go="${esc(other)}"><b>${esc(shortName(other))}</b> <i>${line ? `L${line} ` : ''}${esc(ob?.file ?? '')}</i></button>`;
  };
  const list = (es: Edge[], dir: 'by' | 'uses') => (es.length ? es.map((e) => chip(e, dir)).join('') : '<span class="bp-none">nothing in the current map</span>');
  const st = b.status === 'same' ? '' : `<span class="bp-tag bp-t-${b.status}">${b.status === 'mod' ? 'modified' : b.status === 'new' ? 'new' : 'deleted'}</span>`;
  el.innerHTML =
    `<div class="bp-ih"><span class="bp-bk">${b.kind}</span><span class="bp-nm">${esc(b.name)}</span>${st}</div>` +
    `<div class="bp-loc">${esc(b.file)} : ${lineRange(b)}</div>` +
    `<button class="bp-btn" id="bp-openbtn">Open in editor</button><span class="bp-none" id="bp-openmsg"></span>` +
    `<div class="bp-grp"><h4>Used by</h4>${list(by, 'by')}</div><div class="bp-grp"><h4>Uses</h4>${list(uses, 'uses')}</div>`;
  el.querySelectorAll<HTMLElement>('[data-go]').forEach((c) => (c.onclick = () => goBlock(c.dataset.go as string)));
  $('bp-openbtn').onclick = async () => {
    const msg = $('bp-openmsg');
    msg.textContent = '';
    try {
      const r = await fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: b.file, line: firstLineOf(b) }) });
      if (!r.ok) msg.textContent = ((await r.json()) as { error?: string }).error ?? 'could not open';
    } catch {
      msg.textContent = 'could not reach the watcher';
    }
  };
}

function renderChanges(): void {
  const el = $('bp-changes');
  if (!state) return;
  const g = state.graph;
  const rows = Object.keys(g.fstat).sort().filter((f) => g.fstat[f] !== 'same');
  if (!rows.length) {
    el.innerHTML = `<p>No changes. The map matches ${esc(g.meta?.baseline ?? 'the baseline')}. Edit and save a file and the changed blocks will light up here.</p>`;
    return;
  }
  el.innerHTML = rows.map((f) => {
    const s = g.fstat[f];
    const mark = s === 'new' ? ['+', 'bp-n'] : s === 'del' ? ['-', 'bp-d'] : ['~', 'bp-c2'];
    const c = counts(f);
    const small = s === 'new' ? 'new file' : s === 'del' ? 'deleted' : `${c.mod + c.nw + c.del || 1} blocks`;
    return `<button class="bp-it" data-f="${esc(f)}"><span class="bp-m ${mark[1]}">${mark[0]}</span><span>${esc(fileName(f))}</span><small>${esc(small)}</small></button>`;
  }).join('');
  el.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => (b.onclick = () => goFile(b.dataset.f as string)));
}

function renderMeta(): void {
  if (!state) return;
  const m = state.graph.meta;
  $('bp-base').textContent = m?.baseline ?? 'HEAD';
  const bits = [`${Object.keys(state.graph.fstat).length} files`, `${Object.keys(state.graph.blocks).length} blocks`, `${state.graph.edges.filter((e) => e.status !== 'del').length} arrows`];
  if (m?.typeErrors) bits.push(`${m.typeErrors} type errors, arrows may be incomplete`);
  $('bp-meta').textContent = bits.join('  |  ');
  ($('bp-empty') as HTMLElement).hidden = Object.keys(state.graph.fstat).length > 0;
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
  if (!moved && !(e.target as HTMLElement).closest('.bp-file') && !(e.target as HTMLElement).closest('.bp-tools')) select(null);
});
let first = true;
async function load(): Promise<void> {
  const r = await fetch('/api/state');
  if (!r.ok) throw new Error(`state ${r.status}`);
  const next = (await r.json()) as State;
  const prev = state;
  const prevSigs = prev ? new Map(Object.entries(prev.graph.blocks).map(([id, b]) => [id, sigOf(b)])) : null;
  state = next;
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
  const es = new EventSource('/api/events');
  es.addEventListener('rev', (ev) => {
    const rev = (JSON.parse((ev as MessageEvent).data) as { rev: number }).rev;
    live.textContent = 'watching';
    live.className = 'bp-live on';
    if (!state || rev !== state.rev) void load().catch(() => {});
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
$('bp-relayout').onclick = async () => {
  await fetch('/api/relayout', { method: 'POST' }).catch(() => {});
  await load().catch(() => {});
  fitAll(500);
};
new ResizeObserver(() => {
  if (!touched && state) fitAll(0);
  scheduleFill();
}).observe(vp);

apply();
connect();
void load().catch((e: unknown) => {
  $('bp-live').textContent = 'could not load';
  $('bp-live').className = 'bp-live off';
  $('bp-meta').textContent = e instanceof Error ? e.message : String(e);
});
