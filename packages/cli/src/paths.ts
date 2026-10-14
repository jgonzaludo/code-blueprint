import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// the ui bundle sits next to the cli bundle (dist/ui, see tsup.config.ts). when running from
// source (tests, dev) it lives in the ui package's own dist instead.
const here = path.dirname(fileURLToPath(import.meta.url));
const bundled = path.join(here, 'ui');
const fromSource = path.resolve(here, '../../ui/dist');
export const defaultUiDir = fs.existsSync(path.join(bundled, 'index.html')) ? bundled : fromSource;
