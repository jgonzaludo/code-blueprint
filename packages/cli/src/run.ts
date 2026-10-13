import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildFileTree, isTestPath, parseTree, type FileTree } from '@blueprint/core';
import { canOpenBrowser, openBrowser } from './open.js';
import { renderFileTree } from './print.js';
import { serverFile, startServer } from './server.js';

export interface IO {
  out: (s: string) => void;
  err: (s: string) => void;
  cwd: string;
}

const HELP = `blueprint: a live map of real code

usage:
  blueprint                       same as: blueprint watch
  blueprint watch [--port 4711] [--no-open] [--baseline HEAD|disk] [--root .]
  blueprint status [--json]
  blueprint print <file|dir> [--depth 1] [--json]

commands:
  watch    serve the map on 127.0.0.1 and update it as files change
  status   is a watcher running for this project, and where
  print    text tree of a file: entry points and what they call, in call order

planned, not built yet: plan, check, snapshot, tui

options:
  --root <dir>        project root (default: current directory)
  --port <n>          first port to try (default 4711)
  --no-open           don't open a browser tab
  --baseline <b>      HEAD (default, diff against the last commit) or disk (files as they were at start)
  --relayout          throw away the cached file positions and lay out again
  --depth <n>         file hops to expand in print (default 1)
  --json              same data as json
  --include-tests     parse test files too (skipped by default)
  -h, --help          show this
`;

const PLANNED = new Set(['plan', 'check', 'snapshot', 'tui']);

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
        port: { type: 'string' },
        'no-open': { type: 'boolean', default: false },
        baseline: { type: 'string' },
        relayout: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    io.err(`blueprint: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [cmd, target] = positionals;

  if (values.help) {
    io.out(HELP);
    return 0;
  }
  const root0 = path.resolve(io.cwd, values.root ?? '.');
  if (!cmd || cmd === 'watch') return watchCommand(root0, values, io);
  if (cmd === 'status') return statusCommand(root0, values.json === true, io);
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

// the ui bundle sits next to the cli bundle (dist/ui), see tsup.config.ts
const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultUiDir = path.join(here, 'ui');

async function watchCommand(
  root: string,
  values: { port?: string; baseline?: string; 'no-open'?: boolean; 'include-tests'?: boolean; relayout?: boolean },
  io: IO,
): Promise<number> {
  const baseline = values.baseline ?? 'HEAD';
  if (baseline !== 'HEAD' && baseline !== 'disk') {
    io.err('blueprint: --baseline must be HEAD or disk\n');
    return 2;
  }
  const port = values.port === undefined ? 4711 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.err('blueprint: --port must be a port number\n');
    return 2;
  }
  if (!fs.existsSync(path.join(defaultUiDir, 'index.html'))) {
    io.err('blueprint: the ui bundle is missing. run the build first (pnpm build)\n');
    return 1;
  }
  const srv = await startServer({
    root,
    port,
    baseline,
    includeTests: values['include-tests'] === true,
    relayout: values.relayout === true,
    uiDir: defaultUiDir,
    log: (l) => io.err(`${l}\n`),
  });
  io.out(`blueprint  watching ${root}\n`);
  io.out(`blueprint  ${srv.url}\n`);
  if (!values['no-open'] && canOpenBrowser()) await openBrowser(srv.url);

  // run until ctrl-c
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await srv.close();
  return 0;
}

interface ServerInfo {
  pid: number;
  port: number;
  token: string;
  root: string;
  startedAt: string;
}

async function statusCommand(root: string, asJson: boolean, io: IO): Promise<number> {
  const out = (v: unknown, text: string) => io.out(asJson ? `${JSON.stringify(v, null, 2)}\n` : `${text}\n`);
  let info: ServerInfo;
  try {
    info = JSON.parse(fs.readFileSync(serverFile(root), 'utf8')) as ServerInfo;
    process.kill(info.pid, 0); // throws when the process is gone
  } catch {
    out({ running: false, root }, 'blueprint  not running here');
    return 1;
  }
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/status`, { headers: { 'x-blueprint-token': info.token } });
    const s = (await r.json()) as Record<string, unknown>;
    out(
      { running: true, url: `http://127.0.0.1:${info.port}/?t=${info.token}`, ...s },
      `blueprint  running, pid ${info.pid}, http://127.0.0.1:${info.port}/ (${String(s.files)} files, baseline ${String(s.baseline)})`,
    );
    return 0;
  } catch {
    out({ running: false, root, stale: true }, 'blueprint  stale server file, nothing is answering');
    return 1;
  }
}
