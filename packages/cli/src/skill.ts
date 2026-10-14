import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IO } from './run.js';
import { version } from './version.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// the skill files ship at dist/skill/. from source (tests) they're in the repo's skill dir.
export function skillSource(app = false): string {
  const bundled = path.join(here, 'skill', app ? 'claude-app.md' : 'SKILL.md');
  const repo = path.resolve(here, '../../../skill', app ? 'claude-app/SKILL.md' : 'claude-code/SKILL.md');
  for (const p of [bundled, repo]) if (fs.existsSync(p)) return p;
  throw new Error('skill file not found next to the cli. rebuild with pnpm build');
}

export async function skillCommand(
  args: string[],
  o: { root: string; dir?: string; project: boolean; app?: boolean; json?: boolean },
  io: IO,
): Promise<number> {
  const [sub] = args;
  if (sub === 'print') {
    io.out(fs.readFileSync(skillSource(o.app), 'utf8'));
    return 0;
  }
  if (sub === 'install') {
    if (o.app) {
      io.err('blueprint: the Claude app skill is uploaded in the app, not installed from here. print it with: blueprint skill print --app\n');
      return 2;
    }
    // user level by default: ~/.claude/skills. --project puts it in this repo so a team shares it.
    const skills = o.dir ? path.resolve(io.cwd, o.dir) : o.project ? path.join(o.root, '.claude', 'skills') : path.join(os.homedir(), '.claude', 'skills');
    const dest = path.join(skills, 'blueprint', 'SKILL.md');
    const existed = fs.existsSync(dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(skillSource(), dest);
    io.out(`blueprint  ${existed ? 'updated' : 'installed'} the Claude Code skill at ${dest}\n`);
    io.out('blueprint  start a new Claude Code session and ask about your code, or ask for a feature, and it will use Blueprint\n');
    return 0;
  }
  if (sub === 'status') {
    // compare every installed copy with the one this cli ships
    const bundled = fs.readFileSync(skillSource(), 'utf8');
    const spots = [
      { where: 'user', file: path.join(os.homedir(), '.claude', 'skills', 'blueprint', 'SKILL.md') },
      { where: 'project', file: path.join(o.root, '.claude', 'skills', 'blueprint', 'SKILL.md') },
    ];
    const rows = spots.map((s) => {
      if (!fs.existsSync(s.file)) return { ...s, state: 'not installed' as const };
      return { ...s, state: fs.readFileSync(s.file, 'utf8') === bundled ? ('up to date' as const) : ('outdated' as const) };
    });
    if (o.json) io.out(`${JSON.stringify({ version: version(), copies: rows }, null, 2)}\n`);
    else {
      io.out(`blueprint ${version()}\n`);
      for (const r of rows) io.out(`  ${r.where.padEnd(8)} ${r.state}${r.state === 'not installed' ? '' : `  ${r.file}`}\n`);
      if (rows.some((r) => r.state === 'outdated')) io.out('  an installed skill is older than this cli. run: blueprint skill install\n');
    }
    return 0;
  }
  io.err('usage: blueprint skill <install|print|status> [--project] [--dir <skills dir>] [--app]\n');
  return 2;
}
