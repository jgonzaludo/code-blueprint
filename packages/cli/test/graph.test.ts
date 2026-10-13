import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphBuilder } from '../src/graph.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-graph-'));
  dirs.push(d);
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), c);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return d;
}

const A = "import { b } from './b';\nexport function a() {\n  return b();\n}\n";
const B = 'export function b() {\n  return 1;\n}\n';

describe('GraphBuilder', () => {
  it('has no changes right after a commit', () => {
    const d = repo({ 'src/a.ts': A, 'src/b.ts': B });
    const { graph } = new GraphBuilder({ root: d, baseline: 'HEAD', includeTests: false }).build();
    expect(Object.values(graph.fstat).every((s) => s === 'same')).toBe(true);
    expect(graph.edges.map((e) => e.status)).toEqual(['same']);
    expect(graph.meta?.baseline).toMatch(/^HEAD [0-9a-f]{7}$/);
  });

  it('marks uncommitted edits against HEAD', () => {
    const d = repo({ 'src/a.ts': A, 'src/b.ts': B });
    fs.writeFileSync(path.join(d, 'src/b.ts'), B.replace('return 1', 'return 2'));
    fs.writeFileSync(path.join(d, 'src/c.ts'), 'export function c() {\n  return 3;\n}\n');
    const { graph } = new GraphBuilder({ root: d, baseline: 'HEAD', includeTests: false }).build();
    expect(graph.fstat['src/b.ts']).toBe('mod');
    expect(graph.fstat['src/c.ts']).toBe('new');
    expect(graph.fstat['src/a.ts']).toBe('same');
  });

  it('keeps the baseline across rebuilds in disk mode', () => {
    const d = repo({ 'src/a.ts': A, 'src/b.ts': B });
    const gb = new GraphBuilder({ root: d, baseline: 'disk', includeTests: false });
    gb.build();
    fs.writeFileSync(path.join(d, 'src/b.ts'), B.replace('return 1', 'return 2'));
    expect(gb.build().graph.fstat['src/b.ts']).toBe('mod');
  });

  it('falls back to disk when there is no git repo', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-nogit-'));
    dirs.push(d);
    fs.writeFileSync(path.join(d, 'a.ts'), 'export function a() {}\n');
    const { graph } = new GraphBuilder({ root: d, baseline: 'HEAD', includeTests: false }).build();
    expect(graph.meta?.baseline).toBe('disk');
    expect(graph.fstat['a.ts']).toBe('same');
  });

  it('skips test files by default', () => {
    const d = repo({ 'src/a.ts': A, 'src/b.ts': B, 'src/a.test.ts': "import { a } from './a';\na();\n" });
    const { graph } = new GraphBuilder({ root: d, baseline: 'HEAD', includeTests: false }).build();
    expect(Object.keys(graph.fstat)).not.toContain('src/a.test.ts');
  });
});
