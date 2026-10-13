import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { collectBlocks } from './blocks.js';
import { collectEdges } from './edges.js';
import type { BlockId, ParsedBlock, ParsedTree } from './types.js';

// same options the prototype used. lib.dom is only here so `console` resolves.
// the real build will load the project's tsconfig and fall back to these (m1).
export const defaultOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
};

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'coverage', '.git']);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(path.join(dir, e.name));
    return e.name.endsWith('.ts') ? [path.join(dir, e.name)] : [];
  });
}

// parse one tree on disk into blocks, call edges and file edges.
// m0 behavior: type errors abort, like the prototype. m1 drops that (section 8.4).
export function parseTree(rootDir: string): ParsedTree {
  const root = path.resolve(rootDir);
  const files = walk(root);
  const fileSet = new Set(files);
  const program = ts.createProgram(files, defaultOptions);
  const checker = program.getTypeChecker();

  const errs = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length) {
    const msg = errs.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n');
    throw new Error(`type errors in ${root}\n${msg}`);
  }

  const rel = (f: string) => path.relative(root, f).split(path.sep).join('/');
  const blocks = new Map<BlockId, ParsedBlock>();
  const nodes = new Map<BlockId, ts.Node>();
  const fedges = new Set<string>();

  for (const sf of program.getSourceFiles()) {
    if (!fileSet.has(sf.fileName)) continue;
    const f = rel(sf.fileName);
    const got = collectBlocks(sf, f);
    for (const b of got.blocks) blocks.set(b.id, b);
    for (const [id, n] of got.nodes) nodes.set(id, n);

    for (const im of sf.statements.filter(ts.isImportDeclaration)) {
      const spec = im.moduleSpecifier;
      if (!ts.isStringLiteral(spec)) continue;
      const r = ts.resolveModuleName(spec.text, sf.fileName, defaultOptions, ts.sys).resolvedModule;
      if (r && fileSet.has(path.resolve(r.resolvedFileName))) fedges.add(`${f}|${rel(r.resolvedFileName)}`);
    }
  }

  const edges = collectEdges(nodes, checker, (fn) => fileSet.has(fn));
  return { blocks, edges, fedges, files: files.map(rel) };
}
