import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { collectBlocks } from './blocks.js';
import { collectEdges } from './edges.js';
import type { BlockId, ParsedBlock, ParsedTree } from './types.js';

// fallback options, same as the prototype. lib.dom is only here so `console` resolves.
export const defaultOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  // js parses through the same pipeline, just without type checking it
  allowJs: true,
  checkJs: false,
};

export interface ParseOptions {
  // repo-relative path (forward slashes) -> draft contents, or null to delete.
  // served before disk, so drafts parse without ever touching it.
  overlay?: Map<string, string | null>;
  // skip the tsconfig lookup and use these instead
  compilerOptions?: ts.CompilerOptions;
  // drop files by repo-relative path (e.g. tests). nothing is excluded by default.
  exclude?: (rel: string) => boolean;
  // ignore what's on disk and parse only the overlay. used for baselines read from git.
  overlayOnly?: boolean;
  // count type errors (default true). off skips a full semantic pass, handy for hot paths.
  diagnostics?: boolean;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'coverage', '.git', '.blueprint']);
const SRC_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const MAX_LINES = 5000;

// test files and type-level test files, by name or by living in a test dir
export const isTestPath = (rel: string): boolean =>
  /(^|\/)(test|tests|__tests__)\//.test(rel) || /\.(test|spec)(-d)?\.[cm]?[jt]sx?$/.test(rel);

const norm = (p: string) => p.split(path.sep).join('/');
export const isSourcePath = (f: string): boolean => SRC_EXT.test(f) && !/\.d\.(ts|mts|cts)$/.test(f);
const isSource = isSourcePath;

function walk(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // root may only exist as an overlay
  }
  return entries.flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(path.join(dir, e.name));
    return isSource(e.name) ? [path.join(dir, e.name)] : [];
  });
}

// root's own tsconfig.json if there is one (not ancestors, so fixtures stay isolated), else defaults
export function loadCompilerOptions(root: string): ts.CompilerOptions {
  const cfg = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(cfg)) return { ...defaultOptions };
  const read = ts.readConfigFile(cfg, ts.sys.readFile);
  if (read.error || !read.config) return { ...defaultOptions };
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
  return {
    ...defaultOptions,
    ...parsed.options,
    // we only read, never emit. composite/incremental would add rules we don't care about.
    noEmit: true,
    composite: false,
    incremental: false,
    declaration: false,
    declarationMap: false,
    skipLibCheck: true,
    allowJs: true,
    checkJs: false,
  };
}

// minified or giant generated files just make noise
function tooBig(text: string): boolean {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && n <= MAX_LINES; i = text.indexOf('\n', i + 1)) n++;
  return n > MAX_LINES;
}

// parse one tree into blocks, call edges and file edges.
// never throws on type errors. it counts them and keeps going (section 8.4).
export function parseTree(rootDir: string, opts: ParseOptions = {}): ParsedTree {
  const root = norm(path.resolve(rootDir));
  const options = opts.compilerOptions ?? loadCompilerOptions(root);

  const overlay = new Map<string, string | null>();
  for (const [rel, content] of opts.overlay ?? []) overlay.set(`${root}/${rel}`, content);

  // disk files, minus deleted, plus drafted
  const exclude = opts.exclude;
  const fileList = new Set(opts.overlayOnly ? [] : walk(root).map(norm));
  for (const [abs, content] of overlay) {
    if (content === null) fileList.delete(abs);
    else if (isSource(abs)) fileList.add(abs);
  }
  for (const f of [...fileList]) if (exclude?.(f.slice(root.length + 1))) fileList.delete(f);

  const base = ts.createCompilerHost(options, true);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (f) => (overlay.has(norm(f)) ? overlay.get(norm(f)) !== null : base.fileExists(f)),
    // module resolution asks this before looking for files, so overlay-only dirs must say yes
    directoryExists: (d) =>
      [...overlay].some(([k, v]) => v !== null && k.startsWith(`${norm(d)}/`)) || (base.directoryExists?.(d) ?? false),
    readFile: (f) => (overlay.has(norm(f)) ? (overlay.get(norm(f)) ?? undefined) : base.readFile(f)),
    getSourceFile: (f, lang, onError, shouldCreate) => {
      const o = overlay.get(norm(f));
      if (overlay.has(norm(f))) return o === null || o === undefined ? undefined : ts.createSourceFile(f, o, lang, true);
      return base.getSourceFile(f, lang, onError, shouldCreate);
    },
  };

  // size cap: drop huge files before the program ever sees them
  const files: string[] = [];
  for (const f of [...fileList].sort()) {
    const text = host.readFile(f);
    if (text === undefined || tooBig(text)) continue;
    files.push(f);
  }
  const fileSet = new Set(files);

  const program = ts.createProgram({ rootNames: files, options, host });
  const checker = program.getTypeChecker();
  const rel = (f: string) => norm(path.relative(root, f));

  const blocks = new Map<BlockId, ParsedBlock>();
  const nodes = new Map<BlockId, ts.Node[]>();
  const fedges = new Set<string>();
  const texts = new Map<string, string>();
  let typeErrors = 0;

  for (const sf of program.getSourceFiles()) {
    if (!fileSet.has(sf.fileName)) continue;
    const f = rel(sf.fileName);
    texts.set(f, sf.getFullText());
    if (opts.diagnostics !== false) {
      for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) {
        if (d.category === ts.DiagnosticCategory.Error) typeErrors++;
      }
    }
    const got = collectBlocks(sf, f);
    for (const b of got.blocks) blocks.set(b.id, b);
    for (const [id, n] of got.nodes) nodes.set(id, n);

    // file edges: imports and `export ... from`
    for (const st of sf.statements) {
      const spec = ts.isImportDeclaration(st) || ts.isExportDeclaration(st) ? st.moduleSpecifier : undefined;
      if (!spec || !ts.isStringLiteral(spec)) continue;
      const r = ts.resolveModuleName(spec.text, sf.fileName, options, host).resolvedModule;
      const target = r && norm(path.resolve(r.resolvedFileName));
      if (target && fileSet.has(target)) fedges.add(`${f}|${rel(target)}`);
    }
  }

  const { edges, selfEdges } = collectEdges(nodes, blocks, checker, (fn) => fileSet.has(norm(fn)));
  return { blocks, edges, selfEdges, fedges, files: files.map(rel), texts, typeErrors };
}
