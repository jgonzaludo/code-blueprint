import ts from 'typescript';
import type { BlockId, ParsedEdge } from './types.js';

// walk every identifier in every block and record calls that resolve to another block.
// key is from|to|callText so repeat calls on one line dedupe.
export function collectEdges(
  nodes: Map<BlockId, ts.Node>,
  checker: ts.TypeChecker,
  isProjectFile: (fileName: string) => boolean,
): Map<string, ParsedEdge> {
  const edges = new Map<string, ParsedEdge>();

  for (const [id, node] of nodes) {
    const sf = node.getSourceFile();
    const lines = sf.getFullText().split('\n');

    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        // skip decl names so params, vars and the block's own name don't count as calls
        const isDecl =
          !!p &&
          (p as { name?: ts.Node }).name === n &&
          (ts.isParameter(p) || ts.isVariableDeclaration(p) || p === node || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p));
        // for a.b() the call expression wraps the property access, not the bare name
        let c: ts.Node = n;
        if (p && ts.isPropertyAccessExpression(p) && p.name === n) c = p;
        const cp = c.parent;
        if (!isDecl && cp && ts.isCallExpression(cp) && cp.expression === c) {
          let sym = checker.getSymbolAtLocation(n);
          if (sym && sym.flags & ts.SymbolFlags.Alias) {
            try {
              sym = checker.getAliasedSymbol(sym);
            } catch {
              // unresolvable alias, keep the alias symbol itself
            }
          }
          for (const d of sym?.declarations ?? []) {
            const dsf = d.getSourceFile();
            if (!isProjectFile(dsf.fileName)) continue;
            // the block whose range contains the declaration (methods land on their class)
            let tid: BlockId | undefined;
            for (const [k, nd] of nodes) {
              if (nd.getSourceFile() === dsf && d.pos >= nd.pos && d.end <= nd.end) {
                tid = k;
                break;
              }
            }
            if (!tid || tid === id) continue;
            const callLine = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
            const targetLine = dsf.getLineAndCharacterOfPosition(d.getStart(dsf)).line;
            const e: ParsedEdge = {
              from: id,
              to: tid,
              callText: (lines[callLine] ?? '').trim(),
              targetText: (dsf.getFullText().split('\n')[targetLine] ?? '').trim(),
            };
            edges.set(`${e.from}|${e.to}|${e.callText}`, e);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  }
  return edges;
}
