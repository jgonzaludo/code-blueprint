import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../src/run.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const skill = fs.readFileSync(path.join(repo, 'skill/claude-code/SKILL.md'), 'utf8');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function bp(args: string[], cwd: string) {
  let out = '';
  let err = '';
  const code = await run(args, { out: (s) => (out += s), err: (s) => (err += s), cwd });
  return { code, out, err };
}

describe('the skill file', () => {
  it('has the frontmatter Claude Code needs', () => {
    const m = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('blueprint');
    // fires on plain questions about code, not only on feature requests
    expect(m?.[2]).toMatch(/what a file, function or feature does/);
    expect(m?.[2]).toMatch(/plan, draft or add a feature/);
  });

  it('only uses subcommands the cli actually has', async () => {
    const help = (await bp(['--help'], repo)).out;
    const used = new Set<string>();
    for (const m of skill.matchAll(/`(?:blueprint|npx code-blueprint)\s+([a-z]+)(?:\s+([a-z]+))?/g)) {
      used.add(m[1] as string);
      if (m[1] === 'plan' && m[2]) used.add(`plan ${m[2]}`);
    }
    expect(used.size).toBeGreaterThan(4);
    for (const u of used) {
      const [cmd, sub] = u.split(' ');
      expect(help, `skill uses '${u}', which --help does not list`).toContain(sub ? `blueprint ${cmd} ${sub}` : `blueprint ${cmd}`);
    }
  });

  it('has no em dashes', () => {
    expect(skill).not.toContain('—');
  });
});

describe('blueprint skill', () => {
  it('prints the skill', async () => {
    const r = await bp(['skill', 'print'], repo);
    expect(r.code).toBe(0);
    expect(r.out).toBe(skill);
  });

  it('installs it under a skills dir and says where', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-skill-'));
    dirs.push(d);
    const r = await bp(['skill', 'install', '--dir', path.join(d, 'skills')], d);
    expect(r.code).toBe(0);
    const dest = path.join(d, 'skills/blueprint/SKILL.md');
    expect(fs.readFileSync(dest, 'utf8')).toBe(skill);
    expect(r.out).toContain(dest);
    // a second install says updated
    expect((await bp(['skill', 'install', '--dir', path.join(d, 'skills')], d)).out).toContain('updated');
  });

  it('installs into the project with --project', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-skill-'));
    dirs.push(d);
    const r = await bp(['skill', 'install', '--project', '--root', d], d);
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(d, '.claude/skills/blueprint/SKILL.md'))).toBe(true);
  });
});
