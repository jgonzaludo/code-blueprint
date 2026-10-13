import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

// one static bundle: app.js, style.css, index.html, and the two fonts copied next to them.
const dist = path.resolve('dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  outfile: path.join(dist, 'app.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  logLevel: 'warning',
});

const fonts = [
  ['node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2', 'schibsted-grotesk.woff2'],
  ['node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-400.woff2'],
  ['node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2', 'jetbrains-mono-600.woff2'],
];
for (const [from, to] of fonts) fs.copyFileSync(from, path.join(dist, 'fonts', to));

fs.copyFileSync('src/style.css', path.join(dist, 'style.css'));
fs.copyFileSync('src/index.html', path.join(dist, 'index.html'));
