#!/usr/bin/env node
import { run } from './run.js';

run(process.argv.slice(2), {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  cwd: process.cwd(),
  stdin: async () => {
    if (process.stdin.isTTY) return null;
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  },
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`blueprint: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  },
);
