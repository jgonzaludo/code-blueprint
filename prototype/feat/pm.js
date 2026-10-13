const D = JSON.parse(document.getElementById('data').textContent);
const $ = id => document.getElementById(id);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function hl(s) {
	return esc(s).replace(/(\/\/.*$)|(&quot;[^&]*?&quot;|"[^"]*?"|`[^`]*?`)|\b(import|from|function|const|return|if|throw|new|class|async|await|export|for|of|type|interface|private|constructor|declare)\b|\b(\d+)\b/g,
		(m, c, str, kw, nu) => c ? '<span class="cm">' + m + '</span>' : str ? '<span class="st">' + m + '</span>' : kw ? '<span class="kw">' + m + '</span>' : '<span class="nu">' + m + '</span>');
}
const COLW = 420, GAP = 16, PAD = 16, FH = 112, BG = 12, LH = 14, BHH = 26;
const LAYOUT = [
	{f: 'src/api/refundHandler.ts', x: 0, y: 0, cols: [['imports', 'loadOrder', 'refundHandler']]},
	{f: 'src/refunds.ts', x: 560, y: 0, cols: [['imports', 'calculateRefundTotal', 'restockOrderItems'], ['refundOrder']]},
	{f: 'src/api/checkout.ts', x: 0, y: 620, cols: [['imports', 'loadOrder', 'checkoutHandler']]},
	{f: 'src/jobs/retry.ts', x: 0, y: 1040, cols: [['imports', 'retryFailed']]},
	{f: 'src/orders.ts', x: 560, y: 560, cols: [['imports', 'processOrder'], ['calculateOrderTotal', 'reserveOrderStock'], ['Inventory'], ['OrderStatus', 'Product', 'OrderItem', 'Order']]},
	{f: 'src/utils/money.ts', x: 2440, y: 560, cols: [['roundMoney']]},
	{f: 'src/audit/log.ts', x: 2440, y: 820, cols: [['AuditEntry', 'recordAudit']]}
];
const B = D.blocks, pos = {}, cards = {};
const bh = b => BHH + 6 + b.lines.length * LH + 6;
for (const L of LAYOUT) {
	let maxH = 0;
	L.cols.forEach((col, ci) => {
		let y = L.y + FH;
		col.forEach(nm => {
			const b = B[L.f + '::' + nm]; if (!b) throw new Error('missing ' + L.f + '::' + nm);
			pos[b.id] = {x: L.x + PAD + ci * (COLW + GAP), y, w: COLW, h: bh(b), col: ci, f: L.f};
			y += bh(b) + BG;
		});
		maxH = Math.max(maxH, y - L.y - FH);
	});
	cards[L.f] = {x: L.x, y: L.y, w: PAD * 2 + L.cols.length * COLW + (L.cols.length - 1) * GAP, h: FH + maxH + PAD - BG + 4};
}
const world = $('world'), vp = $('vp');
let html = '';
for (const L of LAYOUT) {
	const c = cards[L.f], st = D.fstat[L.f], parts = L.f.split('/'), name = parts.pop();
	html += '<div class="file ' + st + '" data-f="' + L.f + '" style="left:' + c.x + 'px;top:' + c.y + 'px;width:' + c.w + 'px;height:' + c.h + 'px"><div class="fh"><span class="fn"><span class="dir">' + parts.join('/') + '/</span>' + name + '</span><span class="row"><span class="badge b-new" data-bn="' + L.f + '"></span><span class="badge b-mod" data-bm="' + L.f + '"></span><span class="badge b-use" data-bu="' + L.f + '"></span></span></div></div>';
}
for (const id in pos) {
	const b = B[id], p = pos[id];
	const lines = b.lines.map(l => '<div class="ln d-' + (l.d === '+' ? 'p' : l.d === '-' ? 'm' : 's') + '"><span class="g"><span class="go">' + (l.o ?? '') + '</span><span class="gn">' + (l.n ?? '') + '</span></span><span class="c">' + hl(l.t) + '</span></div>').join('');
	html += '<div class="blk ' + b.kind + ' ' + b.status + '" tabindex="0" data-id="' + id + '" style="left:' + p.x + 'px;top:' + p.y + 'px;width:' + p.w + 'px;height:' + p.h + 'px"><div class="bh"><span class="bk">' + b.kind + '</span><span class="bn">' + esc(b.name) + '</span><span class="tag t-new">new</span><span class="tag t-mod">modified</span></div><div class="bb">' + lines + '</div></div>';
}
html += '<svg class="arrows fedges" id="fsvg" width="3000" height="1500"></svg><svg class="arrows bedges" id="bsvg" width="3000" height="1500"></svg>';
world.innerHTML = html;

/* arrows */
let mode = 'base', sel = null;
const NS = 'http://www.w3.org/2000/svg';
const PLAN_ONLY = {from: 'src/api/refundHandler.ts::refundHandler', to: 'src/audit/log.ts::recordAudit', callText: 'recordAudit("refund.requested", order.id);', targetText: 'export function recordAudit(action: string, orderId: string): void {', status: 'new', planOnly: true};
function lineIdx(b, text, m) {
	let n = -1;
	for (let i = 0; i < b.lines.length; i++) {
		const l = b.lines[i]; if (m === 'base' && l.d === '+') continue;
		if (l.t.trim() === text) return visIdx(b, i, m);
	}
	return -1;
}
function visIdx(b, i, m) { let k = 0; for (let j = 0; j < i; j++) if (!(m === 'base' && b.lines[j].d === '+')) k++; return k; }
function anchorY(id, text, m) { const b = B[id], i = lineIdx(b, text, m); return pos[id].y + BHH + 6 + (i < 0 ? 0 : i) * LH + 7; }
function route(e, m) {
	const a = pos[e.from], t = pos[e.to];
	const y1 = e.planOnly ? pos[e.from].y + BHH + 6 + 5 * LH + 7 : anchorY(e.from, e.callText, m);
	const y2 = anchorY(e.to, e.targetText, m);
	if (t.x >= a.x + a.w) { const x1 = a.x + a.w, x2 = t.x, dx = Math.max(40, (x2 - x1) / 2.4); return {d: 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + (x2 - 4) + ' ' + y2, x: x1, y: y1}; }
	if (t.x + t.w <= a.x) { const x1 = a.x, x2 = t.x + t.w, dx = Math.max(40, (x1 - x2) / 2.4); return {d: 'M' + x1 + ' ' + y1 + ' C' + (x1 - dx) + ' ' + y1 + ' ' + (x2 + dx) + ' ' + y2 + ' ' + (x2 + 4) + ' ' + y2, x: x1, y: y1}; }
	const x1 = a.x + a.w, x2 = t.x + t.w, o = Math.max(x1, x2) + 50;
	return {d: 'M' + x1 + ' ' + y1 + ' C' + o + ' ' + y1 + ' ' + o + ' ' + y2 + ' ' + (x2 + 4) + ' ' + y2, x: x1, y: y1};
}
const visible = id => !(mode === 'base' && B[id].status === 'new');
function drawEdges() {
	const bs = $('bsvg'), fs = $('fsvg');
	const defs = '<defs><marker id="mb" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path class="mk-b" d="M0 0L8 4L0 8z"/></marker><marker id="mn" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path class="mk-n" d="M0 0L8 4L0 8z"/></marker><marker id="mg" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path class="mk-g" d="M0 0L8 4L0 8z"/></marker></defs>';
	let s = defs;
	const list = D.edges.filter(e => e.status !== 'del' && visible(e.from) && visible(e.to));
	if (mode !== 'base') list.push(PLAN_ONLY);
	list.forEach(e => {
		const gone = e.planOnly && mode === 'applied';
		if (e.planOnly && mode === 'base') return;
		const r = route(e, mode === 'base' ? 'base' : 'new');
		const cls = 'ed ' + (gone ? 'gone' : e.status === 'new' ? 'new' : '') + ((sel && e.from !== sel && e.to !== sel) ? ' dim' : '');
		const mk = gone ? 'mg' : e.status === 'new' ? 'mn' : 'mb';
		s += '<path class="' + cls + '" d="' + r.d + '" marker-end="url(#' + mk + ')"/><circle class="edot ' + (gone ? 'gone' : e.status === 'new' ? 'new' : '') + '" cx="' + r.x + '" cy="' + r.y + '" r="3.4"/>';
	});
	bs.innerHTML = s;
	// file level
	let f = defs.replace(/id="m/g, 'id="fm').replace(/#m/g, '#fm');
	const counts = {};
	D.edges.forEach(e => { if (e.status === 'del') return; const k = pos[e.from].f + '|' + pos[e.to].f; if (pos[e.from].f !== pos[e.to].f) { counts[k] = counts[k] || {n: 0, s: 0}; counts[k][e.status === 'new' ? 'n' : 's']++; } });
	D.fedges.forEach(fe => {
		if (mode === 'base' && fe.status === 'new') return;
		const a = cards[fe.from], t = cards[fe.to]; if (!a || !t) return;
		const ax = a.x + a.w / 2, ay = a.y + a.h / 2, tx = t.x + t.w / 2, ty = t.y + t.h / 2;
		let x1, y1, x2, y2, d;
		if (t.x >= a.x + a.w) { x1 = a.x + a.w; y1 = Math.min(Math.max(ay, a.y + 60), a.y + a.h - 20); x2 = t.x; y2 = Math.min(Math.max(ty, t.y + 60), t.y + t.h - 20); const dx = (x2 - x1) / 2.2; d = 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + (x2 - 8) + ' ' + y2; }
		else { x1 = Math.max(a.x, t.x) + 140 + (fe.from.length % 5) * 60; x1 = Math.min(x1, Math.min(a.x + a.w, t.x + t.w) - 20); const down = t.y > a.y; y1 = down ? a.y + a.h : a.y; y2 = down ? t.y : t.y + t.h; x2 = x1; d = 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + (y2 + (down ? -8 : 8)); }
		const nw = fe.status === 'new';
		const s2 = '<path class="ed ' + (nw ? 'new' : '') + '" d="' + d + '" marker-end="url(#fm' + (nw ? 'n' : 'b') + ')"/>';
		f += s2;
	});
	fs.innerHTML = f;
}

/* camera */
const cam = {x: 0, y: 0, s: .35};
function apply() { world.style.transform = 'translate(' + cam.x + 'px,' + cam.y + 'px) scale(' + cam.s + ')'; const map = cam.s < 0.5; world.classList.toggle('map', map); world.classList.toggle('code', !map); $('lvl').textContent = map ? 'Project map' : cam.s < 0.95 ? 'File' : 'Code, line for line'; }
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let raf = null;
function animateTo(t, ms) {
	cancelAnimationFrame(raf);
	if (reduce || !ms) { Object.assign(cam, t); apply(); return; }
	const a = {...cam}, t0 = performance.now();
	const step = now => { let k = Math.min(1, (now - t0) / ms); k = 1 - Math.pow(1 - k, 3);
		const s = a.s * Math.pow(t.s / a.s, k);
		cam.s = s; cam.x = a.x + (t.x - a.x) * k; cam.y = a.y + (t.y - a.y) * k; apply(); if (k < 1) raf = requestAnimationFrame(step); };
	raf = requestAnimationFrame(step);
}
function rectCam(r, pad, max) { const vw = vp.clientWidth, vh = vp.clientHeight; const s = Math.min(max || 1.5, vw / (r.w + pad * 2), vh / (r.h + pad * 2)); return {s, x: vw / 2 - (r.x + r.w / 2) * s, y: vh / 2 - (r.y + r.h / 2) * s}; }
function bounds() {
	let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
	LAYOUT.forEach(L => { if (mode === 'base' && D.fstat[L.f] === 'new') return; const c = cards[L.f]; x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h); });
	return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
}
const fitAll = ms => animateTo(rectCam(bounds(), 30, 1), ms);
function zoomBy(f, cx, cy) { const vw = vp.clientWidth, vh = vp.clientHeight; cx = cx ?? vw / 2; cy = cy ?? vh / 2; const s = Math.min(2.2, Math.max(.12, cam.s * f)), k = s / cam.s; cam.x = cx - (cx - cam.x) * k; cam.y = cy - (cy - cam.y) * k; cam.s = s; apply(); }
vp.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const r = vp.getBoundingClientRect(); cancelAnimationFrame(raf); zoomBy(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top); }, {passive: false});
let drag = null, moved = false;
vp.addEventListener('pointerdown', e => { if (e.target.closest('.tools')) return; drag = {x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y}; moved = false; cancelAnimationFrame(raf); vp.setPointerCapture(e.pointerId); vp.classList.add('drag'); });
vp.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true; cam.x = drag.cx + dx; cam.y = drag.cy + dy; apply(); });
vp.addEventListener('pointerup', e => { drag = null; vp.classList.remove('drag'); });
$('zi').onclick = () => { cancelAnimationFrame(raf); zoomBy(1.4); }; $('zo').onclick = () => { cancelAnimationFrame(raf); zoomBy(1 / 1.4); }; $('fit').onclick = () => fitAll(500);

/* selection + inspector */
const short = id => id.split('::')[1];
function gutter(id, text) { const b = B[id]; const i = b.lines.findIndex(l => l.t.trim() === text && !(mode === 'base' && l.d === '+')); if (i < 0) return '?'; const l = b.lines[i]; return mode === 'base' ? l.o : (l.d === '-' ? l.o : l.n); }
function inspect() {
	const el = $('insp');
	if (!sel) { el.innerHTML = '<div class="ph">Select a block to see where it comes up and how it is used. Zoom out to see the project, zoom in to read every line.</div>'; return; }
	const b = B[sel], vis = e => e.status !== 'del' && visible(e.from) && visible(e.to) && !(mode === 'base' && e.status === 'new');
	const by = D.edges.filter(e => e.to === sel && vis(e)), uses = D.edges.filter(e => e.from === sel && vis(e));
	const chip = (e, dir) => { const o = dir === 'by' ? e.from : e.to; const f = pos[o].f; return '<span class="chip' + (e.status === 'new' ? ' nw' : '') + '"><b>' + short(o) + '</b> <i>' + (dir === 'by' ? 'L' + gutter(e.from, e.callText) : 'L' + gutter(e.from, e.callText)) + (f !== b.file ? ' ' + f : '') + '</i></span>'; };
	const st = b.status === 'new' ? (mode === 'plan' ? 'proposed, not in the code yet' : mode === 'applied' ? 'new block' : '') : b.status === 'mod' && mode !== 'base' ? 'modified, ' + b.lines.filter(l => l.d !== ' ').length + ' changed lines' : '';
	const first = b.lines.find(l => l.d !== '+') || b.lines[0], last = [...b.lines].reverse().find(l => l.d !== '+') || b.lines[0];
	el.innerHTML = '<div class="ih"><span class="bk">' + b.kind + '</span><span class="nm">' + esc(b.name) + '</span><span class="lc">' + b.file + (b.status !== 'new' || mode === 'applied' ? ' : ' + (mode === 'base' ? first.o + '-' + last.o : (b.lines.find(l => l.n)?.n) + '-' + ([...b.lines].reverse().find(l => l.n)?.n)) : '') + '</span>' + (st ? '<span class="chip nw">' + st + '</span>' : '') + '</div>'
		+ '<div class="cols"><div><h5>Used by</h5><div class="chips">' + (by.length ? by.map(e => chip(e, 'by')).join('') : '<span class="chip"><i>nothing in the current map</i></span>') + '</div></div><div><h5>Uses</h5><div class="chips">' + (uses.length ? uses.map(e => chip(e, 'uses')).join('') : '<span class="chip"><i>nothing</i></span>') + '</div></div></div>';
}
function select(id) {
	sel = id;
	document.querySelectorAll('.blk').forEach(e => { const rel = !id || e.dataset.id === id || D.edges.some(x => (x.from === id && x.to === e.dataset.id) || (x.to === id && x.from === e.dataset.id)); e.classList.toggle('sel', e.dataset.id === id); e.classList.toggle('dim', !rel); });
	drawEdges(); inspect();
	if (window.pmOnSelect) pmOnSelect(id);
}
world.addEventListener('click', e => {
	if (moved) return;
	const b = e.target.closest('.blk');
	if (b) { if (cam.s < .5) { goFile(pos[b.dataset.id].f); select(b.dataset.id); } else select(b.dataset.id); return; }
	if (!e.target.closest('.file')) select(null);
});
world.addEventListener('dblclick', e => { const f = e.target.closest('.file'); if (f) goFile(f.dataset.f); });
vp.addEventListener('click', e => { if (!moved && !e.target.closest('.file') && !e.target.closest('.tools')) select(null); });
function goFile(f) { const c = cards[f]; animateTo(rectCam({x: c.x, y: c.y, w: c.w, h: c.h}, 30, 1.5), 700); }
function goBlock(id) { const p = pos[id]; animateTo(rectCam({x: p.x, y: p.y, w: p.w, h: p.h}, 80, 1.8), 700); select(id); }

/* modes + plan panel */
const newBlocks = Object.values(B).filter(b => b.status === 'new' && b.kind !== 'imports');
function side() {
	const sb = $('sb'), sh = $('sh');
	const newFiles = Object.keys(D.fstat).filter(f => D.fstat[f] === 'new');
	const changed = Object.values(B).filter(b => b.status === 'mod');
	const touched = [...new Set(D.edges.filter(e => e.status === 'new').map(e => pos[e.to].f))].filter(f => D.fstat[f] === 'same');
	const item = (m, cls, label, small, act) => '<button class="it" data-go="' + act + '"><span class="m ' + cls + '">' + m + '</span><span>' + label + '</span><small>' + small + '</small></button>';
	if (mode === 'base') { sh.textContent = 'Current project'; sb.innerHTML = '<p>' + Object.keys(D.fstat).filter(f => D.fstat[f] !== 'new').length + ' files. Select Claude\'s plan to see what a refund feature would add and change.</p><p>Zoom in on any file to read it exactly as it is on disk.</p>'; wire(); return; }
	sh.textContent = mode === 'plan' ? 'Claude\'s plan' : 'After applying';
	let h = '';
	h += '<div class="grp"><h4>New files, above the map</h4>' + newFiles.map(f => item('+', 'n', f.split('/').pop(), Object.values(B).filter(b => b.file === f && b.kind !== 'imports').length + ' blocks', 'f:' + f)).join('') + '</div>';
	h += '<div class="grp"><h4>Changed files</h4>' + changed.map(b => item('~', 'c', b.file.split('/').pop() + ' ' + b.name, b.name === 'Inventory' ? '+ restock slot' : '1 line', 'b:' + b.id)).join('') + '</div>';
	h += '<div class="grp"><h4>Used by the new code</h4>' + touched.map(f => item('>', 'u', f.split('/').pop(), 'unchanged', 'f:' + f)).join('') + '</div>';
	const nNew = D.edges.filter(e => e.status === 'new').length;
	if (mode === 'plan') h += '<div class="rec"><b>Proposed.</b> ' + (nNew + 1) + ' dashed arrows are Claude\'s claims about what will call what. They stay dashed until the parser checks the real code.</div>';
	else h += '<div class="rec bad"><b>' + nNew + ' of ' + (nNew + 1) + ' proposed arrows confirmed</b> by the parser after the edit.<ul><li>Not in the code: <code>refundHandler</code> to <code>recordAudit</code>. The plan expected a "refund.requested" audit line and the handler never writes one.</li></ul></div>';
	sb.innerHTML = h; wire();
}
function wire() { document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { const [k, v] = b.dataset.go.split(/:(.+)/); if (k === 'f') goFile(v); else goBlock(v); }); }
function badges() {
	document.querySelectorAll('.badge').forEach(b => { b.classList.remove('on'); b.textContent = ''; });
	const set = (sel, t) => { const e = document.querySelector(sel); if (e) { e.textContent = t; e.classList.add('on'); } };
	Object.keys(D.fstat).forEach(f => {
		if (D.fstat[f] === 'new') set('[data-bn="' + f + '"]', 'NEW  ' + Object.values(B).filter(b => b.file === f && b.kind !== 'imports').length + ' blocks');
		if (D.fstat[f] === 'mod') { const ch = Object.values(B).filter(b => b.file === f && b.status === 'mod').length; set('[data-bm="' + f + '"]', '~' + ch + ' modified  +1 new slot'); }
	});
	D.edges.filter(e => e.status === 'new').forEach(e => { const f = pos[e.to].f; if (D.fstat[f] === 'same') set('[data-bu="' + f + '"]', 'used by new code'); });
}
function setMode(m) {
	const was = mode; mode = m;
	world.classList.remove('mode-base', 'mode-plan', 'mode-applied'); world.classList.add('mode-' + m);
	document.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === m));
	if (sel && !visible(sel)) sel = null;
	select(sel); badges(); side();
	if (was !== m && (m === 'base' || was === 'base')) fitAll(900);
	if (window.pmOnMode) pmOnMode(m, was);
}
document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => setMode(b.dataset.m));
addEventListener('resize', () => { /* keep camera */ });
setMode('base'); fitAll(0); apply();
