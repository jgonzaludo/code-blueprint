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

// the app's own fonts (Anthropic Sans and Mono) are proprietary and can't be shipped, so these are the
// closest open ones. the css puts the app's fonts first, so wherever they exist they win.
const fonts = [
  ['node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2', 'instrument-sans.woff2'],
  ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2'],
  ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-500.woff2'],
];
for (const [from, to] of fonts) fs.copyFileSync(from, path.join(dist, 'fonts', to));

fs.copyFileSync('src/style.css', path.join(dist, 'style.css'));
fs.copyFileSync('src/index.html', path.join(dist, 'index.html'));
