import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  // core is a workspace package that ships as ts source, so fold it into the bundle.
  // typescript stays external, it's a real dependency.
  noExternal: ['@blueprint/core'],
  external: ['typescript', 'elkjs'],
  // the map page is built by packages/ui (build that first), served from dist/ui
  onSuccess: async () => {
    const src = path.resolve('../ui/dist');
    const dest = path.resolve('dist/ui');
    if (!fs.existsSync(src)) throw new Error('packages/ui/dist is missing, run `pnpm --filter @blueprint/ui build` first');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    // the claude code skill ships next to the cli so `blueprint skill install` can copy it
    const skillSrc = path.resolve('../../skill/claude-code/SKILL.md');
    fs.mkdirSync(path.resolve('dist/skill'), { recursive: true });
    fs.copyFileSync(skillSrc, path.resolve('dist/skill/SKILL.md'));
  },
});
