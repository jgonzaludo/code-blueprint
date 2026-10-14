import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// the build bakes the version in (see tsup.config.ts). from source (tests) we read package.json.
declare const __BLUEPRINT_VERSION__: string | undefined;

export function version(): string {
  if (typeof __BLUEPRINT_VERSION__ === 'string') return __BLUEPRINT_VERSION__;
  const here = path.dirname(fileURLToPath(import.meta.url));
  try {
    return (JSON.parse(fs.readFileSync(path.join(here, '../package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}
