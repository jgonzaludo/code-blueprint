import ts from 'typescript';
import type { BlockId, ParsedBlock } from './types.js';

export interface CollectedBlocks {
  blocks: ParsedBlock[];
  // ast nodes behind each block, edges walk these. merged blocks have several.
  nodes: Map<BlockId, ts.Node[]>;
}

const isFnLike = (e: ts.Expression | undefined): boolean =>
  !!e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isClassExpression(e));

const hasMod = (n: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === kind);

const dedent = (slice: string[]): string[] => {
  const indents = slice.filter((l) => l.trim()).map((l) => (/^\s*/.exec(l) as RegExpExecArray)[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return slice.map((l) => l.slice(cut));
};

// pull the top-level blocks out of one source file.
export function collectBlocks(sf: ts.SourceFile, file: string): CollectedBlocks {
  const byId = new Map<BlockId, ParsedBlock>();
  const nodes = new Map<BlockId, ts.Node[]>();
  const lines = sf.getFullText().split('\n');
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  // first line of a node, pulling in comment lines sitting right above the decl
  const startWithComments = (node: ts.Node): number => {
    let start = lineOf(node.getStart(sf));
    while (start > 1 && /^\s*(\/\/|\/\*|\*)/.test(lines[start - 2] ?? '')) start--;
    return start;
  };

  const add = (node: ts.Node, kind: ParsedBlock['kind'], name: string, members: ParsedBlock['members'] = [], exported = false) => {
    const start = startWithComments(node);
    const end = lineOf(node.getEnd());
    const code = dedent(lines.slice(start - 1, end));
    const lineNums = code.map((_, i) => start + i);
    const id = `${file}::${name}`;
    const prev = byId.get(id);
    if (prev) {
      // same name twice (overloads, interface merging): one block, all the lines
      prev.code.push(...code);
      prev.lineNums.push(...lineNums);
      prev.members.push(...members);
      prev.end = Math.max(prev.end, end);
      prev.exported = prev.exported || exported || undefined;
      nodes.get(id)?.push(node);
      return;
    }
    const b: ParsedBlock = { id, file, kind, name, start, end, lineNums, code, members };
    if (exported) b.exported = true;
    byId.set(id, b);
    nodes.set(id, [node]);
  };

  // all imports collapse into one block, first import to last
  const imps = sf.statements.filter(ts.isImportDeclaration);
  if (imps.length) {
    const s = lineOf((imps[0] as ts.ImportDeclaration).getStart(sf));
    const e = lineOf((imps[imps.length - 1] as ts.ImportDeclaration).getEnd());
    const id = `${file}::imports`;
    const code = lines.slice(s - 1, e);
    // imports aren't edge sources, so no node is registered
    byId.set(id, { id, file, kind: 'imports', name: 'imports', start: s, end: e, lineNums: code.map((_, i) => s + i), code, members: [] });
  }

  const leftovers: ts.Node[] = [];

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) continue;
    const exported = hasMod(st, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasMod(st, ts.SyntaxKind.DefaultKeyword);

    if (ts.isClassDeclaration(st)) {
      const name = st.name?.text ?? (isDefault ? 'default' : null);
      if (!name) { leftovers.push(st); continue; }
      const members = st.members.map((m) => ({
        name: ts.isConstructorDeclaration(m) ? 'constructor' : (m.name?.getText() ?? ''),
        line: lineOf(m.getStart(sf)),
      }));
      add(st, 'class', isDefault ? 'default' : name, members, exported);
    } else if (ts.isFunctionDeclaration(st)) {
      const name = st.name?.text ?? (isDefault ? 'default' : null);
      if (!name) { leftovers.push(st); continue; }
      add(st, 'function', isDefault ? 'default' : name, [], exported);
    } else if (ts.isInterfaceDeclaration(st)) add(st, 'interface', st.name.text, [], exported);
    else if (ts.isTypeAliasDeclaration(st)) add(st, 'type', st.name.text, [], exported);
    else if (ts.isEnumDeclaration(st)) add(st, 'enum', st.name.text, [], exported);
    else if (ts.isModuleDeclaration(st)) {
      add(st, 'namespace', st.name.text, [], exported);
    } else if (ts.isVariableStatement(st)) {
      const decls = st.declarationList.declarations;
      const single = decls.length === 1;
      // destructuring and plain non-exported values stay in the module block
      const wanted = (d: ts.VariableDeclaration) => ts.isIdentifier(d.name) && (isFnLike(d.initializer) || exported);
      for (const d of decls) {
        // one declarator: the whole statement is the block. several: each declarator on its own.
        if (wanted(d)) add(single ? st : d, 'const', (d.name as ts.Identifier).text, [], exported);
      }
      if (decls.some((d) => !wanted(d))) leftovers.push(st);
    } else if (ts.isExportAssignment(st) && !ts.isIdentifier(st.expression)) {
      // export default <arrow | object | call | ...>
      add(st, 'const', 'default', [], true);
    } else leftovers.push(st);
  }

  // leftover statements (calls, export {}, re-exports, plain consts) go in one module block
  if (leftovers.length) {
    const wanted = new Set<number>();
    for (const n of leftovers) {
      const s = startWithComments(n);
      const e = lineOf(n.getEnd());
      for (let l = s; l <= e; l++) wanted.add(l);
    }
    const lineNums = [...wanted].sort((a, b) => a - b);
    const id = `${file}::module`;
    byId.set(id, {
      id, file, kind: 'module', name: 'module',
      start: lineNums[0] as number, end: lineNums[lineNums.length - 1] as number,
      lineNums, code: dedent(lineNums.map((l) => lines[l - 1] ?? '')), members: [],
    });
    nodes.set(id, leftovers);
  }

  return { blocks: [...byId.values()], nodes };
}
