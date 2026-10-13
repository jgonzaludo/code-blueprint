import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IO } from './run.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// the skill file ships at dist/skill/SKILL.md. from source (tests) it's in the repo's skill dir.
export function skillSource(): string {
  for (const p of [path.join(here, 'skill', 'SKILL.md'), path.resolve(here, '../../../skill/claude-code/SKILL.md')]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('SKILL.md not found next to the cli. rebuild with pnpm build');
}

export async function skillCommand(
  args: string[],
  o: { root: string; dir?: string; project: boolean },
  io: IO,
): Promise<number> {
  const [sub] = args;
  if (sub === 'print') {
    io.out(fs.readFileSync(skillSource(), 'utf8'));
    return 0;
  }
  if (sub === 'install') {
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
  io.err('usage: blueprint skill <install|print> [--project] [--dir <skills dir>]\n');
  return 2;
}
