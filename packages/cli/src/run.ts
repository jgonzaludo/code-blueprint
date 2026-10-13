import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildFileTree, isTestPath, parseTree, type FileTree } from '@blueprint/core';
import { renderFileTree } from './print.js';

export interface IO {
  out: (s: string) => void;
  err: (s: string) => void;
  cwd: string;
}

const HELP = `blueprint: a map of real code

usage:
  blueprint print <file|dir> [--root .] [--depth 1] [--json] [--include-tests]

commands:
  print    text tree of a file: entry points and what they call, in call order

planned, not built yet: watch, plan, check, snapshot, status, tui
options:
  --root <dir>      project root (default: current directory)
  --depth <n>       file hops to expand (default 1, callees in other files are listed but not expanded)
  --json            same data as json
  --include-tests   parse test files too (skipped by default)
  -h, --help        show this
`;

const PLANNED = new Set(['watch', 'plan', 'check', 'snapshot', 'status', 'tui']);

// returns the exit code. 0 ok, 1 runtime problem, 2 bad usage.
export async function run(argv: string[], io: IO): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        root: { type: 'string' },
        depth: { type: 'string' },
        json: { type: 'boolean', default: false },
        'include-tests': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    io.err(`blueprint: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [cmd, target] = positionals;

  if (values.help || !cmd) {
    io.out(HELP);
    return cmd || values.help ? 0 : 2;
  }
  if (PLANNED.has(cmd)) {
    io.err(`blueprint: '${cmd}' is not built yet. see docs/CONTEXT.md section 19 for the order.\n`);
    return 2;
  }
  if (cmd !== 'print') {
    io.err(`blueprint: unknown command '${cmd}'. try --help\n`);
    return 2;
  }
  if (!target) {
    io.err('blueprint: print needs a file or directory\n');
    return 2;
  }

  const depth = values.depth === undefined ? 1 : Number(values.depth);
  if (!Number.isInteger(depth) || depth < 1) {
    io.err('blueprint: --depth must be a whole number, 1 or more\n');
    return 2;
  }

  const root = path.resolve(io.cwd, values.root ?? '.');
  const abs = path.resolve(root, target);
  if (!fs.existsSync(abs)) {
    io.err(`blueprint: ${target} does not exist\n`);
    return 1;
  }
  const relTarget = path.relative(root, abs).split(path.sep).join('/');
  if (relTarget.startsWith('..')) {
    io.err(`blueprint: ${target} is outside the root ${root}\n`);
    return 1;
  }
  const isDir = fs.statSync(abs).isDirectory();

  // tests are skipped unless asked for, except a test file you name directly
  const tree = parseTree(root, {
    exclude: values['include-tests'] ? undefined : (rel) => isTestPath(rel) && rel !== relTarget,
  });

  const files = isDir
    ? tree.files.filter((f) => relTarget === '' || relTarget === '.' || f.startsWith(`${relTarget}/`)).sort()
    : tree.files.includes(relTarget)
      ? [relTarget]
      : [];
  if (!files.length) {
    io.err(`blueprint: no parsed source files for ${target}${values['include-tests'] ? '' : ' (test files are skipped, use --include-tests)'}\n`);
    return 1;
  }

  const trees: FileTree[] = files.map((f) => buildFileTree(tree, f, { depth }));
  if (tree.typeErrors > 0) io.err(`blueprint: ${tree.typeErrors} type errors, arrows may be incomplete\n`);

  if (values.json) {
    io.out(`${JSON.stringify({ root, typeErrors: tree.typeErrors, files: trees }, null, 2)}\n`);
    return 0;
  }
  if (!isDir) {
    io.out(`${renderFileTree(trees[0] as FileTree)}\n`);
    return 0;
  }
  io.out(
    trees
      .filter((t) => t.roots.length)
      .map((t) => `== ${t.file} ==\n${renderFileTree(t)}`)
      .join('\n\n') + '\n',
  );
  return 0;
}
