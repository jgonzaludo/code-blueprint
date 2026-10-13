import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTree } from '../src/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const demo = path.join(repo, 'examples/refund-demo');

const listFiles = (dir: string, base = dir): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')],
  );

describe('overlay file system', () => {
  it('before + overlay of the after files parses the same as after', () => {
    const afterRoot = path.join(demo, 'after');
    const overlay = new Map<string, string | null>();
    for (const f of listFiles(afterRoot)) overlay.set(f, fs.readFileSync(path.join(afterRoot, f), 'utf8'));

    const viaOverlay = parseTree(path.join(demo, 'before'), { overlay });
    const direct = parseTree(afterRoot);

    expect([...viaOverlay.blocks]).toEqual([...direct.blocks]);
    expect([...viaOverlay.edges]).toEqual([...direct.edges]);
    expect([...viaOverlay.fedges].sort()).toEqual([...direct.fedges].sort());
    expect(viaOverlay.files.sort()).toEqual(direct.files.sort());
  });

  it('null deletes a file from the tree', () => {
    const root = path.join(demo, 'after');
    const t = parseTree(root, { overlay: new Map([['src/refunds.ts', null]]) });
    expect(t.files).not.toContain('src/refunds.ts');
    expect([...t.blocks.keys()].some((id) => id.startsWith('src/refunds.ts::'))).toBe(false);
  });

  it('works on a root that only exists as an overlay, and never touches disk', () => {
    const overlay = new Map<string, string | null>([
      ['src/a.ts', "import { b } from './b';\nexport function a() {\n  return b();\n}\n"],
      ['src/b.ts', 'export function b() {\n  return 1;\n}\n'],
    ]);
    const t = parseTree('/does/not/exist', { overlay });
    expect([...t.edges.values()].map((e) => `${e.from} -> ${e.to}`)).toEqual(['src/a.ts::a -> src/b.ts::b']);
  });
});
