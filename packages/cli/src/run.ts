import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildFileTree, isTestPath, parseTree, type FileTree } from '@blueprint/core';
import { canOpenBrowser, drivenByClaude, openBrowser } from './open.js';
import { defaultUiDir } from './paths.js';
import { snapshotCommand } from './snapshot.js';
import { checkCommand, planCommand } from './planCommands.js';
import { skillCommand } from './skill.js';
import { version } from './version.js';
import { renderFileTree } from './print.js';
import { serverFile, startServer } from './server.js';

export interface IO {
  out: (s: string) => void;
  err: (s: string) => void;
  cwd: string;
  // piped input, null when stdin is a terminal. only plan add reads it.
  stdin?: () => Promise<string | null>;
}

const HELP = `blueprint: a live map of real code

usage:
  blueprint                       same as: blueprint watch
  blueprint watch [--port 4711] [--no-open] [--baseline HEAD|disk] [--root .]
  blueprint status [--json]
  blueprint print <file|dir> [--depth 1] [--json]
  blueprint plan new <id> [--title "..."]
  blueprint plan add <id> <file> [--from <path>]     (or pipe the draft on stdin)
  blueprint plan rm <id> <file>
  blueprint plan claim <id> <fromBlock> <toBlock> [--note "..."]
  blueprint plan ready <id>                          (drafting is done, ready for the user to review)
  blueprint plan approve <id>                        (the user's go, same as the Approve button)
  blueprint plan changes <id> [--note "..."]         (the user wants changes)
  blueprint plan status [id] [--json]
  blueprint plan show [id] [--json]
  blueprint plan apply <id> [--yes]                  (refuses until approved, --yes when the user said go in chat)
  blueprint plan archive <id>
  blueprint plan drop <id>
  blueprint plan list
  blueprint check [id] [--json]
  blueprint snapshot [--plan <id>] [--out map.html] [--all]
  blueprint skill install [--project] [--dir <skills dir>]
  blueprint skill print [--app]
  blueprint skill status                 (is an installed skill older than this cli?)
  blueprint --version

commands:
  watch    serve the map on 127.0.0.1 and update it as files change
  status   is a watcher running for this project, and where
  print    text tree of a file: entry points and what they call, in call order
  plan     draft a feature as full files, see it as an overlay, apply it
  check    after applying: which planned arrows the real code has
  snapshot one self-contained html file of the map, works offline from file://
  skill    install the Claude Code skill so Claude drives all of this for you

planned, not built yet: snapshot, tui

options:
  --root <dir>        project root (default: current directory)
  --port <n>          first port to try (default 4711)
  --no-open           don't open a browser tab
  --baseline <b>      HEAD (default, diff against the last commit) or disk (files as they were at start)
  --relayout          throw away the cached file positions and lay out again
  --depth <n>         file hops to expand in print (default 1)
  --app               with skill print: the Claude app variant (snapshot and artifact, no watcher)
  --out <file>        where snapshot writes (default blueprint-map.html)
  --plan <id>         snapshot this plan (default: the newest)
  --all               snapshot the whole project, not just a plan and one hop
  --project           install the skill for this project only (.claude/skills), not for you
  --dir <path>        install the skill under this skills directory
  --title <t>         plan title (plan new)
  --from <path>       read a draft from this file instead of stdin (plan add)
  --note <text>       why a claimed arrow is expected (plan claim), or what to change (plan changes)
  --yes               plan apply: the user already said go in chat
  --json              same data as json
  --include-tests     parse test files too (skipped by default)
  -h, --help          show this
`;

const PLANNED = new Set(['tui']);

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
        out: { type: 'string' },
        plan: { type: 'string' },
        all: { type: 'boolean', default: false },
        dir: { type: 'string' },
        app: { type: 'boolean', default: false },
        project: { type: 'boolean', default: false },
        title: { type: 'string' },
        from: { type: 'string' },
        note: { type: 'string' },
        port: { type: 'string' },
        'no-open': { type: 'boolean', default: false },
        baseline: { type: 'string' },
        relayout: { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (e) {
    io.err(`blueprint: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [cmd, target] = positionals;

  if (values.version || positionals[0] === 'version') {
    io.out(`${version()}\n`);
    return 0;
  }
  if (values.help) {
    io.out(HELP);
    return 0;
  }
  const root0 = path.resolve(io.cwd, values.root ?? '.');
  if (!cmd || cmd === 'watch') return watchCommand(root0, values, io);
  if (cmd === 'status') return statusCommand(root0, values.json === true, io);
  if (cmd === 'snapshot') {
    return snapshotCommand(
      { root: root0, out: values.out, plan: values.plan, all: values.all === true, includeTests: values['include-tests'] === true, baseline: values.baseline === 'disk' ? 'disk' : 'HEAD' },
      io,
    );
  }
  if (cmd === 'skill') return skillCommand(positionals.slice(1), { root: root0, dir: values.dir, project: values.project === true, app: values.app === true, json: values.json === true }, io);
  if (cmd === 'plan' || cmd === 'check') {
    const o = { yes: values.yes === true, title: values.title, from: values.from, note: values.note, json: values.json === true, includeTests: values['include-tests'] === true };
    return cmd === 'check' ? checkCommand(root0, positionals[1], o, io) : planCommand(root0, positionals.slice(1), o, io);
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
  if (!values['no-open'] && drivenByClaude()) {
    io.out('blueprint  not opening your browser (started from Claude Code), use the url above or the browser pane\n');
  } else if (!values['no-open'] && canOpenBrowser()) await openBrowser(srv.url);

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
