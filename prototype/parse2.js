// File-basis parser: one main file becomes blocks (class = container with members) plus edges.
// Anything the main file uses from other files is included one hop only, with its origin path.
// usage: node parse2.js <demoDir> <mainRel> <out.json>
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const [demoDir, mainRel, outFile] = process.argv.slice(2);
const root = path.resolve(demoDir);

function walk(d) {
	return fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []);
}
const files = walk(root);
const program = ts.createProgram(files, {
	target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
	strict: true, noEmit: true, skipLibCheck: true,
});
const checker = program.getTypeChecker();
const rel = f => path.relative(root, f).split(path.sep).join('/');

const diags = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
if (diags.length) {
	console.error(diags.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
	throw new Error('demo files do not type check');
}

const blocks = new Map();
const nodeToBlock = new Map();
const fileTexts = {};

function addBlock(node, kind, name, parentId, sf) {
	const lines = sf.getFullText().split('\n');
	let start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
	const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
	// pull in the comment lines directly above the block
	while (start > 1 && /^\s*(\/\/|\/\*|\*)/.test(lines[start - 2])) start--;
	const slice = lines.slice(start - 1, end);
	const indents = slice.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length);
	const cut = indents.length ? Math.min(...indents) : 0;
	const code = slice.map(l => l.slice(cut)).join('\n');
	const id = rel(sf.fileName) + '::' + (parentId ? parentId.split('::')[1] + '.' : '') + name;
	const b = {id, kind, name, parent: parentId || null, file: rel(sf.fileName), start, end, code};
	blocks.set(id, b);
	nodeToBlock.set(node, id);
	return id;
}

for (const sf of program.getSourceFiles()) {
	if (!files.includes(sf.fileName)) continue;
	fileTexts[rel(sf.fileName)] = sf.getFullText();
	for (const stmt of sf.statements) {
		if (ts.isClassDeclaration(stmt) && stmt.name) {
			const cid = addBlock(stmt, 'class', stmt.name.text, null, sf);
			for (const m of stmt.members) {
				if (ts.isConstructorDeclaration(m)) addBlock(m, 'constructor', 'constructor', cid, sf);
				else if (ts.isMethodDeclaration(m)) addBlock(m, 'method', m.name.getText(), cid, sf);
			}
		} else if (ts.isFunctionDeclaration(stmt) && stmt.name) addBlock(stmt, 'function', stmt.name.text, null, sf);
		else if (ts.isInterfaceDeclaration(stmt)) addBlock(stmt, 'interface', stmt.name.text, null, sf);
		else if (ts.isTypeAliasDeclaration(stmt)) addBlock(stmt, 'type', stmt.name.text, null, sf);
	}
}

const blockFor = decl => { for (let n = decl; n; n = n.parent) if (nodeToBlock.has(n)) return nodeToBlock.get(n); return null; };
const aliased = sym => { if (sym && sym.flags & ts.SymbolFlags.Alias) { try { return checker.getAliasedSymbol(sym); } catch { return null; } } return sym; };

const edges = new Map();
function addEdge(from, to, type, line) {
	if (from === to) return;
	const k = from + '|' + to + '|' + type;
	if (!edges.has(k)) edges.set(k, {from, to, type, lines: []});
	const e = edges.get(k);
	if (!e.lines.includes(line)) e.lines.push(line);
}

for (const [node, id] of nodeToBlock) {
	if (ts.isClassDeclaration(node)) continue; // members carry the edges
	const sf = node.getSourceFile();
	const walkNode = n => {
		if (n !== node && nodeToBlock.has(n)) return;
		if (ts.isIdentifier(n)) {
			const p = n.parent;
			const isDeclName = p && p.name === n && (ts.isParameter(p) || nodeToBlock.get(p) === id || ts.isVariableDeclaration(p));
			if (!isDeclName) {
				const sym = aliased(checker.getSymbolAtLocation(n));
				for (const d of sym?.declarations || []) {
					const tid = blockFor(d);
					if (!tid || tid === id) continue;
					const tb = blocks.get(tid);
					let c = n;
					if (p && ts.isPropertyAccessExpression(p) && p.name === n) c = p;
					const cp = c.parent;
					let type = 'uses';
					if (cp && ts.isCallExpression(cp) && cp.expression === c) type = 'calls';
					else if (cp && ts.isNewExpression(cp) && cp.expression === c) type = 'instantiates';
					else if (p && ts.isTypeReferenceNode(p)) type = 'type';
					const dataTarget = tb.kind === 'interface' || tb.kind === 'type';
					if (dataTarget && type !== 'type') continue; // property reads are not data-model links
					addEdge(id, tid, type, sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
				}
			}
		}
		ts.forEachChild(n, walkNode);
	};
	walkNode(node);
}

// keep: all main-file blocks, plus blocks in other files that a main-file block uses directly (one hop)
const all = [...blocks.values()];
const inMain = b => b.file === mainRel;
const mainEdges = [...edges.values()].filter(e => inMain(blocks.get(e.from)));
const extIds = new Set(mainEdges.map(e => e.to).filter(t => !inMain(blocks.get(t))));
const keep = new Set([...all.filter(inMain).map(b => b.id), ...extIds]);

const outBlocks = all.filter(b => keep.has(b.id)).map(b => {
	const o = {...b, external: !inMain(b)};
	if (o.external) {
		o.alsoUses = [...new Set([...edges.values()].filter(e => e.from === b.id && !keep.has(e.to)).map(e => blocks.get(e.to).name))];
	}
	return o;
});
const outEdges = mainEdges.filter(e => keep.has(e.to));

const out = {main: mainRel, files: fileTexts, blocks: outBlocks, edges: outEdges};
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log('blocks', outBlocks.length, 'edges', outEdges.length);
for (const e of outEdges) console.log(' ', e.type.padEnd(6), blocks.get(e.from).id.split('::')[1].padEnd(30), '->', blocks.get(e.to).id.padEnd(40), 'L' + e.lines.join(','));
console.log('external:', outBlocks.filter(b => b.external).map(b => b.id + ' alsoUses=' + b.alsoUses.join('/')).join(' | '));
