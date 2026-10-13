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
  external: ['typescript'],
});
