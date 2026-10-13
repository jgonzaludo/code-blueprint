const $ = id => document.getElementById(id);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function hl(s) {
	return esc(s).replace(/(\/\/.*$)|(&quot;[^&]*?&quot;|"[^"]*?")|\b(import|from|function|const|return|if|throw|new|class|async|await|export|for|of|type|interface|private|constructor)\b|\b(\d+)\b/g,
		(m, c, str, kw, nu) => c ? '<span class="cm">' + m + '</span>' : str ? '<span class="st">' + m + '</span>' : kw ? '<span class="kw">' + m + '</span>' : '<span class="nu">' + m + '</span>');
}
const W = 840, H = 470, HEADH = 26, ORGH = 20, LH = 14;
const BLOCKS = {
	pO: {kind: 'function', name: 'processOrder', cls: 'fn', w: 230, st: [10, 150], rng: [68, 84], lines: [
		'function processOrder(order, inventory) {', '  order.total = calculateOrderTotal(…);', '  reserveOrderStock(order, inventory);',
		'  order.status = "paid";', '  recordAudit("order.paid", order.id);', '  return order;']},
	cOT: {kind: 'function', name: 'calculateOrderTotal', cls: 'fn', w: 240, st: [290, 10], rng: [49, 57], lines: [
		'function calculateOrderTotal(items, inventory) {', '  return roundMoney(items.reduce(…', '    const product = inventory.getProduct(…)',
		'    return total + product.price * …', '  }, 0));']},
	rOS: {kind: 'function', name: 'reserveOrderStock', cls: 'fn', w: 240, st: [290, 160], rng: [59, 66], lines: [
		'function reserveOrderStock(order, inventory) {', '  for (const item of order.items) {', '    inventory.reserve(item.productId, …);', '  }', '}']},
	rA: {kind: 'function', name: 'recordAudit', cls: 'fn', ext: 'src/audit/log.ts', w: 240, st: [290, 300], lines: [
		'export function recordAudit(action, orderId) {', '  const entry: AuditEntry = { action, … };', '  console.log(JSON.stringify(entry));', '}']},
	Inv: {kind: 'class', name: 'Inventory', cls: 'cls', w: 240, st: [590, 10], rng: [25, 47], lines: [
		'constructor(private products: Map<…>) {}', 'getProduct(id: string): Product {', '  const product = this.products.get(id);', '  if (!product) throw new Error(…);',
		'  return product;', '}', 'reserve(productId, quantity): void {', '  const product = this.getProduct(productId);', '  if (product.stock < quantity) throw …;', '  product.stock -= quantity;']},
	rM: {kind: 'function', name: 'roundMoney', cls: 'fn', ext: 'src/utils/money.ts', w: 240, st: [590, 300], lines: [
		'// Rounds to whole cents…', 'export function roundMoney(amount) {', '  return Math.round(… * 100) / 100;', '}']}
};
for (const k in BLOCKS) { const b = BLOCKS[k]; b.h = HEADH + (b.ext ? ORGH : 0) + 6 + b.lines.length * LH + 6; }
const lineY = (k, i) => BLOCKS[k].st[1] + HEADH + (BLOCKS[k].ext ? ORGH : 0) + 6 + i * LH + 7;
const EDGES = [
	{f: 'pO', fl: 1, t: 'cOT'}, {f: 'pO', fl: 2, t: 'rOS'}, {f: 'pO', fl: 4, t: 'rA'},
	{f: 'cOT', fl: 1, t: 'rM'}, {f: 'cOT', fl: 2, t: 'Inv', tl: 1}, {f: 'rOS', fl: 2, t: 'Inv', tl: 6}
];
const PATH = {rA: 'src/audit/log.ts', rM: 'src/utils/money.ts'};
const USAGE = {
	pO: {by: [], uses: [['calculateOrderTotal', 'L76'], ['reserveOrderStock', 'L78'], ['recordAudit', 'L81', 'src/audit/log.ts']]},
	cOT: {by: [['processOrder', 'L76']], uses: [['roundMoney', 'L53', 'src/utils/money.ts'], ['Inventory.getProduct', 'L54']]},
	rOS: {by: [['processOrder', 'L78']], uses: [['Inventory.reserve', 'L64']]},
	rA: {by: [['processOrder', 'L81']], uses: [['AuditEntry', 'not expanded']]},
	Inv: {by: [['calculateOrderTotal', 'L54'], ['reserveOrderStock', 'L64']], uses: []},
	rM: {by: [['calculateOrderTotal', 'L53']], uses: []}
};
const RANGE = {pO: 'src/orders.ts : 68-84', cOT: 'src/orders.ts : 49-57', rOS: 'src/orders.ts : 59-66', Inv: 'src/orders.ts : 25-47', rA: 'src/audit/log.ts : 7-15', rM: 'src/utils/money.ts : 1-4'};
const chip = (a, p) => '<span class="chip' + (a[2] && a[2].includes('/') ? ' x' : '') + '"><b>' + a[0] + '</b> <i>' + a[1] + (a[2] ? ' ' + a[2] : '') + '</i></span>';
function usageHtml(k) {
	const u = USAGE[k];
	return '<div><h4>Used by</h4><div class="chips">' + (u.by.length ? u.by.map(chip).join('') : '<span class="chip none">nothing else in this file</span>') + '</div></div>'
		+ '<div><h4>Uses</h4><div class="chips">' + (u.uses.length ? u.uses.map(chip).join('') : '<span class="chip none">nothing</span>') + '</div></div>';
}

function initCanvas(o) {
	const world = o.world, NS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('class', 'arrows'); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
	svg.innerHTML = '<defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="mk" d="M0 0 L8 4 L0 8 z"/></marker></defs>';
	world.appendChild(svg);
	const cards = {}, arrs = [];
	for (const k in BLOCKS) {
		const b = BLOCKS[k], d = document.createElement('div');
		d.className = 'blk ' + b.cls + (b.ext ? ' ext' : ''); d.tabIndex = 0; d.dataset.k = k;
		d.style.cssText = 'width:' + b.w + 'px;height:' + b.h + 'px;left:' + b.st[0] + 'px;top:' + b.st[1] + 'px';
		d.innerHTML = '<div class="bh"><span class="bk">' + b.kind + '</span><span class="bn">' + b.name + '</span></div>'
			+ (b.ext ? '<div class="bo">from ' + b.ext + '</div>' : '') + '<div class="bb">' + b.lines.map(l => '<div>' + hl(l) + '</div>').join('') + '</div>';
		d.onclick = () => o.onSelect && o.onSelect(k);
		d.onkeydown = e => { if (e.key === 'Enter') o.onSelect && o.onSelect(k); };
		world.appendChild(d); cards[k] = d;
	}
	EDGES.forEach(e => {
		const f = BLOCKS[e.f], t = BLOCKS[e.t];
		const x1 = f.st[0] + f.w, y1 = lineY(e.f, e.fl), x2 = t.st[0], y2 = e.tl != null ? lineY(e.t, e.tl) : t.st[1] + 13;
		const dx = Math.max(30, (x2 - x1) / 2);
		const p = document.createElementNS(NS, 'path');
		p.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + (x2 - 3) + ' ' + y2);
		p.setAttribute('pathLength', '1'); p.setAttribute('class', 'arr'); p.setAttribute('marker-end', 'url(#ah)');
		const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', x1); c.setAttribute('cy', y1); c.setAttribute('r', 3.2); c.setAttribute('class', 'src');
		svg.appendChild(p); svg.appendChild(c); arrs.push({e, p, c});
	});
	requestAnimationFrame(() => requestAnimationFrame(() => arrs.forEach(a => a.p.classList.add('on'))));
	let sel = null;
	const rel = (k, s) => k === s || EDGES.some(e => (e.f === s && e.t === k) || (e.t === s && e.f === k));
	function select(s) {
		sel = s;
		for (const k in cards) { cards[k].classList.toggle('sel', k === s); cards[k].classList.toggle('dim', !!s && !rel(k, s)); }
		arrs.forEach(a => { const hit = !s || a.e.f === s || a.e.t === s; a.p.classList.toggle('dim', !hit); a.c.classList.toggle('dim', !hit); });
	}
	function fit() {
		const s = Math.min(1.3, Math.max(.62, o.cv.clientWidth / W));
		o.fit.style.width = (W * s) + 'px'; o.fit.style.height = (H * s) + 'px'; world.style.transform = 'scale(' + s + ')';
	}
	new ResizeObserver(fit).observe(o.cv); fit();
	return {select, cards};
}
