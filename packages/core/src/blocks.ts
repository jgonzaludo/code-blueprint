import ts from 'typescript';
import type { BlockId, ParsedBlock } from './types.js';

// pull the top-level blocks out of one source file.
// returns the blocks plus the ast node behind each one (edges need the node).
export function collectBlocks(sf: ts.SourceFile, file: string): { blocks: ParsedBlock[]; nodes: Map<BlockId, ts.Node> } {
  const blocks: ParsedBlock[] = [];
  const nodes = new Map<BlockId, ts.Node>();
  const lines = sf.getFullText().split('\n');
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const add = (node: ts.Node, kind: ParsedBlock['kind'], name: string, members: ParsedBlock['members'] = []) => {
    let start = lineOf(node.getStart(sf));
    const end = lineOf(node.getEnd());
    // pull in comment lines sitting right above the decl
    while (start > 1 && /^\s*(\/\/|\/\*|\*)/.test(lines[start - 2] ?? '')) start--;
    const slice = lines.slice(start - 1, end);
    const indents = slice.filter((l) => l.trim()).map((l) => (/^\s*/.exec(l) as RegExpExecArray)[0].length);
    const cut = indents.length ? Math.min(...indents) : 0;
    const b: ParsedBlock = { id: `${file}::${name}`, file, kind, name, start, end, code: slice.map((l) => l.slice(cut)), members };
    blocks.push(b);
    nodes.set(b.id, node);
  };

  // all imports collapse into one block, first import to last
  const imps = sf.statements.filter(ts.isImportDeclaration);
  if (imps.length) {
    const first = imps[0] as ts.ImportDeclaration;
    const last = imps[imps.length - 1] as ts.ImportDeclaration;
    const s = lineOf(first.getStart(sf));
    const e = lineOf(last.getEnd());
    // imports aren't edge sources, so no node is registered for them
    blocks.push({ id: `${file}::imports`, file, kind: 'imports', name: 'imports', start: s, end: e, code: lines.slice(s - 1, e), members: [] });
  }

  for (const st of sf.statements) {
    if (ts.isClassDeclaration(st) && st.name) {
      const members = st.members.map((m) => ({
        name: ts.isConstructorDeclaration(m) ? 'constructor' : (m.name?.getText() ?? ''),
        line: lineOf(m.getStart(sf)),
      }));
      add(st, 'class', st.name.text, members);
    } else if (ts.isFunctionDeclaration(st) && st.name) add(st, 'function', st.name.text);
    else if (ts.isInterfaceDeclaration(st)) add(st, 'interface', st.name.text);
    else if (ts.isTypeAliasDeclaration(st)) add(st, 'type', st.name.text);
  }
  return { blocks, nodes };
}
