import ts from 'typescript';
import type { BlockId, ParsedBlock, ParsedEdge } from './types.js';

interface Span {
  pos: number;
  end: number;
  id: BlockId;
}

const isJsFile = (fileName: string) => /\.(c|m)?jsx?$/.test(fileName);

// walk every identifier in every block and record calls (and `new`s) that resolve to another block.
// key is from|to|callText so repeat calls on one line dedupe.
export function collectEdges(
  nodes: Map<BlockId, ts.Node[]>,
  blocks: Map<BlockId, ParsedBlock>,
  checker: ts.TypeChecker,
  isProjectFile: (fileName: string) => boolean,
): Map<string, ParsedEdge> {
  const edges = new Map<string, ParsedEdge>();

  // per-file interval index, so finding a decl's block doesn't scan every node
  const spans = new Map<ts.SourceFile, Span[]>();
  for (const [id, list] of nodes) {
    for (const n of list) {
      const sf = n.getSourceFile();
      const arr = spans.get(sf) ?? [];
      arr.push({ pos: n.pos, end: n.end, id });
      spans.set(sf, arr);
    }
  }
  const blockAt = (sf: ts.SourceFile, pos: number, end: number): BlockId | undefined =>
    spans.get(sf)?.find((s) => pos >= s.pos && end <= s.end)?.id;

  // unique block names, for the name-match fallback in untyped js
  const byName = new Map<string, BlockId[]>();
  for (const b of blocks.values()) {
    if (b.kind === 'imports' || b.kind === 'module') continue;
    byName.set(b.name, [...(byName.get(b.name) ?? []), b.id]);
  }

  const lineCache = new Map<ts.SourceFile, string[]>();
  const linesOf = (sf: ts.SourceFile) => {
    let l = lineCache.get(sf);
    if (!l) lineCache.set(sf, (l = sf.getFullText().split('\n')));
    return l;
  };

  for (const [id, list] of nodes) {
    for (const node of list) {
      const sf = node.getSourceFile();
      const lines = linesOf(sf);

      const record = (to: BlockId, n: ts.Identifier, targetSf: ts.SourceFile, targetLine0: number, resolution: 'checker' | 'name-match') => {
        const callLine0 = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
        const callText = (lines[callLine0] ?? '').trim();
        const key = `${id}|${to}|${callText}`;
        if (edges.has(key)) return;
        edges.set(key, {
          from: id,
          to,
          callText,
          targetText: (linesOf(targetSf)[targetLine0] ?? '').trim(),
          callLine: callLine0 + 1,
          targetLine: targetLine0 + 1,
          source: 'parser',
          resolution,
        });
      };

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
          const isCall = !!cp && (ts.isCallExpression(cp) || ts.isNewExpression(cp)) && cp.expression === c;
          if (!isDecl && isCall) {
            let sym = checker.getSymbolAtLocation(n);
            if (sym && sym.flags & ts.SymbolFlags.Alias) {
              try {
                // follows imports and re-exports down to the real declaration
                sym = checker.getAliasedSymbol(sym);
              } catch {
                // unresolvable alias, keep the alias symbol itself
              }
            }
            let hit = false;
            for (const d of sym?.declarations ?? []) {
              const dsf = d.getSourceFile();
              if (!isProjectFile(dsf.fileName)) continue;
              // the block whose range contains the declaration (methods land on their class)
              const tid = blockAt(dsf, d.pos, d.end);
              if (!tid || tid === id) continue;
              record(tid, n, dsf, dsf.getLineAndCharacterOfPosition(d.getStart(dsf)).line, 'checker');
              hit = true;
            }
            // untyped js: checker gave up, so fall back to a unique name match and say so
            if (!hit && !sym && isJsFile(sf.fileName)) {
              const cands = byName.get(n.text) ?? [];
              const only = cands.length === 1 ? cands[0] : undefined;
              if (only !== undefined && only !== id) {
                const tb = blocks.get(only);
                const tn = nodes.get(only)?.[0];
                if (tb && tn) record(only, n, tn.getSourceFile(), tb.start - 1, 'name-match');
              }
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(node);
    }
  }
  return edges;
}
