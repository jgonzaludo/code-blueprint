#!/usr/bin/env node
import { run } from './run.js';

run(process.argv.slice(2), {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  cwd: process.cwd(),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`blueprint: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  },
);
