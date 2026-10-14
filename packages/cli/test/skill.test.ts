import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../src/run.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const skill = fs.readFileSync(path.join(repo, 'skill/claude-code/SKILL.md'), 'utf8');
const appSkill = fs.readFileSync(path.join(repo, 'skill/claude-app/SKILL.md'), 'utf8');

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

describe('the Claude app skill', () => {
  it('has valid frontmatter and says what to do with no code', () => {
    const m = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(appSkill);
    expect(m?.[1]).toBe('blueprint-app');
    expect(appSkill).toMatch(/No code: say so/);
    expect(appSkill).toMatch(/same\*\* artifact URL/);
    expect(appSkill).not.toContain('\u2014');
  });

  it('only uses subcommands the cli has', async () => {
    const help = (await bp(['--help'], repo)).out;
    const used = new Set<string>();
    for (const m of appSkill.matchAll(/`(?:blueprint|npx code-blueprint)\s+([a-z]+)(?:\s+([a-z]+))?/g)) {
      used.add(m[1] as string);
      if (m[1] === 'plan' && m[2]) used.add(`plan ${m[2]}`);
    }
    expect(used.has('snapshot')).toBe(true);
    for (const u of used) {
      const [cmd, sub] = u.split(' ');
      expect(help, `app skill uses '${u}'`).toContain(sub ? `blueprint ${cmd} ${sub}` : `blueprint ${cmd}`);
    }
  });

  it('prints with --app and is not installable from here', async () => {
    const p = await bp(['skill', 'print', '--app'], repo);
    expect(p.out).toBe(appSkill);
    const i = await bp(['skill', 'install', '--app'], repo);
    expect(i.code).toBe(2);
  });
});

describe('the plugin', () => {
  it('carries an identical copy of the skill, valid manifests, and no version pin', () => {
    expect(fs.readFileSync(path.join(repo, 'plugin/skills/blueprint/SKILL.md'), 'utf8')).toBe(skill);
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'plugin/.claude-plugin/plugin.json'), 'utf8'));
    expect(manifest.name).toBe('blueprint');
    // no version: every commit then reaches installed copies instead of only bumps
    expect(manifest.version).toBeUndefined();
    const market = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin/marketplace.json'), 'utf8'));
    expect(market.owner.name).toBeTruthy();
    expect(market.plugins[0]).toMatchObject({ name: manifest.name, source: './plugin' });
    expect(fs.existsSync(path.join(repo, 'plugin', '.claude-plugin', 'plugin.json'))).toBe(true);
  });
});

describe('version and skill status', () => {
  it('prints the version', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'packages/cli/package.json'), 'utf8'));
    expect((await bp(['--version'], repo)).out.trim()).toBe(pkg.version);
    expect((await bp(['version'], repo)).out.trim()).toBe(pkg.version);
  });

  it('says outdated, then up to date, for a project copy', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-skill-'));
    dirs.push(d);
    const dest = path.join(d, '.claude/skills/blueprint/SKILL.md');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'an old copy');
    const old = JSON.parse((await bp(['skill', 'status', '--root', d, '--json'], d)).out);
    expect(old.copies.find((c: { where: string }) => c.where === 'project').state).toBe('outdated');
    await bp(['skill', 'install', '--project', '--root', d], d);
    const now = JSON.parse((await bp(['skill', 'status', '--root', d, '--json'], d)).out);
    expect(now.copies.find((c: { where: string }) => c.where === 'project').state).toBe('up to date');
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
