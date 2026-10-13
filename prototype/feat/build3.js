const ts = require('../parser/node_modules/typescript');
const fs = require('fs'), path = require('path');
const opts = {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, skipLibCheck: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts']};
const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []);

function collect(root) {
	root = path.resolve(root);
	const files = walk(root);
	const program = ts.createProgram(files, opts), checker = program.getTypeChecker();
	const errs = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
	if (errs.length) { console.error(root, errs.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')); throw new Error('type errors'); }
	const rel = f => path.relative(root, f).split(path.sep).join('/');
	const blocks = new Map(), nodes = new Map(), fedges = new Set();
	for (const sf of program.getSourceFiles()) {
		if (!files.includes(sf.fileName)) continue;
		const f = rel(sf.fileName), lines = sf.getFullText().split('\n');
		const L = p => sf.getLineAndCharacterOfPosition(p).line + 1;
		const add = (node, kind, name, members) => {
			let start = L(node.getStart(sf)), end = L(node.getEnd());
			while (start > 1 && /^\s*(\/\/|\/\*|\*)/.test(lines[start - 2])) start--;
			const slice = lines.slice(start - 1, end);
			const cut = Math.min(...slice.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
			const b = {id: f + '::' + name, file: f, kind, name, start, end, code: slice.map(l => l.slice(cut)), members: members || []};
			blocks.set(b.id, b); nodes.set(b.id, node);
		};
		const imps = sf.statements.filter(ts.isImportDeclaration);
		if (imps.length) {
			const s = L(imps[0].getStart(sf)), e = L(imps[imps.length - 1].getEnd());
			const b = {id: f + '::imports', file: f, kind: 'imports', name: 'imports', start: s, end: e, code: lines.slice(s - 1, e), members: []};
			blocks.set(b.id, b);
			for (const im of imps) {
				const r = ts.resolveModuleName(im.moduleSpecifier.text, sf.fileName, opts, ts.sys).resolvedModule;
				if (r && files.includes(path.resolve(r.resolvedFileName))) fedges.add(f + '|' + rel(r.resolvedFileName));
			}
		}
		for (const st of sf.statements) {
			if (ts.isClassDeclaration(st) && st.name) add(st, 'class', st.name.text, st.members.map(m => ({name: ts.isConstructorDeclaration(m) ? 'constructor' : m.name.getText(), line: L(m.getStart(sf))})));
			else if (ts.isFunctionDeclaration(st) && st.name) add(st, 'function', st.name.text);
			else if (ts.isInterfaceDeclaration(st)) add(st, 'interface', st.name.text);
			else if (ts.isTypeAliasDeclaration(st)) add(st, 'type', st.name.text);
		}
	}
	const edges = new Map();
	for (const [id, node] of nodes) {
		const sf = node.getSourceFile(), lines = sf.getFullText().split('\n');
		const walkN = n => {
			if (ts.isIdentifier(n)) {
				const p = n.parent;
				const isDecl = p && p.name === n && (ts.isParameter(p) || ts.isVariableDeclaration(p) || p === node || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p));
				let c = n; if (p && ts.isPropertyAccessExpression(p) && p.name === n) c = p;
				const cp = c.parent;
				if (!isDecl && cp && ts.isCallExpression(cp) && cp.expression === c) {
					let sym = checker.getSymbolAtLocation(n);
					if (sym && sym.flags & ts.SymbolFlags.Alias) { try { sym = checker.getAliasedSymbol(sym); } catch {} }
					for (const d of sym?.declarations || []) {
						const dsf = d.getSourceFile(); if (!files.includes(dsf.fileName)) continue;
						const tid = [...nodes].find(([k, nd]) => nd.getSourceFile() === dsf && d.pos >= nd.pos && d.end <= nd.end)?.[0];
						if (!tid || tid === id) continue;
						const callLine = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
						const tl = dsf.getLineAndCharacterOfPosition(d.getStart(dsf)).line;
						const e = {from: id, to: tid, callText: lines[callLine].trim(), targetText: dsf.getFullText().split('\n')[tl].trim()};
						edges.set(e.from + '|' + e.to + '|' + e.callText, e);
					}
				}
			}
			ts.forEachChild(n, walkN);
		};
		walkN(node);
	}
	return {blocks, edges, fedges, files: files.map(rel)};
}
function lcs(a, b) {
	const m = a.length, n = b.length, t = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
	const out = []; let i = 0, j = 0;
	while (i < m && j < n) { if (a[i] === b[j]) { out.push({d: ' ', t: a[i], i, j}); i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) { out.push({d: '-', t: a[i], i}); i++; } else { out.push({d: '+', t: b[j], j}); j++; } }
	while (i < m) out.push({d: '-', t: a[i], i: i++}); while (j < n) out.push({d: '+', t: b[j], j: j++});
	return out;
}
const B = collect('before'), A = collect('after');
const ids = new Set([...B.blocks.keys(), ...A.blocks.keys()]);
const blocks = {};
for (const id of ids) {
	const b = B.blocks.get(id), a = A.blocks.get(id), ref = a || b;
	let lines, status;
	if (!b) { status = 'new'; lines = a.code.map((t, j) => ({t, d: '+', o: null, n: a.start + j})); }
	else if (!a) { status = 'del'; lines = b.code.map((t, i) => ({t, d: '-', o: b.start + i, n: null})); }
	else {
		lines = lcs(b.code, a.code).map(x => ({t: x.t, d: x.d, o: x.i != null ? b.start + x.i : null, n: x.j != null ? a.start + x.j : (x.d === ' ' ? a.start + x.j : null)}));
		// ' ' entries carry both i and j
		lines = lcs(b.code, a.code).map(x => ({t: x.t, d: x.d, o: x.d !== '+' ? b.start + x.i : null, n: x.d !== '-' ? a.start + x.j : null}));
		status = lines.some(l => l.d !== ' ') ? 'mod' : 'same';
	}
	blocks[id] = {id, file: ref.file, kind: ref.kind, name: ref.name, status, lines, members: (a || b).members};
}
const ekey = e => e.from + '|' + e.to + '|' + e.callText;
const edges = [];
for (const [k, e] of A.edges) edges.push({...e, status: B.edges.has(k) ? 'same' : 'new'});
for (const [k, e] of B.edges) if (!A.edges.has(k)) edges.push({...e, status: 'del'});
const fset = new Map();
for (const k of A.fedges) fset.set(k, B.fedges.has(k) ? 'same' : 'new');
const fedges = [...fset].map(([k, s]) => ({from: k.split('|')[0], to: k.split('|')[1], status: s}));
const fstat = {};
for (const f of new Set([...A.files, ...B.files])) {
	const bl = Object.values(blocks).filter(x => x.file === f);
	fstat[f] = !B.files.includes(f) ? 'new' : bl.some(x => x.status !== 'same') ? 'mod' : 'same';
}
const ftext = {};
for (const f of new Set([...A.files, ...B.files])) {
	const rd = (r) => { try { const t = fs.readFileSync(path.join(r, f), 'utf8').split('\n'); if (t[t.length - 1] === '') t.pop(); return t; } catch { return null; } };
	const bt = rd('before'), at = rd('after');
	if (!bt) ftext[f] = at.map((t, j) => ({d: '+', t, o: null, n: j + 1}));
	else ftext[f] = lcs(bt, at).map(x => ({d: x.d, t: x.t, o: x.d !== '+' ? x.i + 1 : null, n: x.d !== '-' ? x.j + 1 : null}));
}
const out = {blocks, edges, fedges, fstat, ftext};
fs.writeFileSync('data.json', JSON.stringify(out));
console.log('blocks', Object.keys(blocks).length, 'edges', edges.length, 'new', edges.filter(e => e.status === 'new').length);
for (const e of edges) console.log(e.status.padEnd(5), e.from.split('/').pop().padEnd(34), '->', e.to.split('/').pop().padEnd(40), '|', e.callText.slice(0, 50));
console.log(JSON.stringify(fstat));
for (const b of Object.values(blocks)) if (b.status !== 'same') console.log(b.id, b.status, b.lines.filter(l => l.d !== ' ').length, 'changed lines');
