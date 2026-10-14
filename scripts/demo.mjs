// one command to see the whole loop: a throwaway project with the refund feature drafted as a plan,
// marked ready for review, with the map running. needs `pnpm -r build` first. ctrl-c cleans up.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = process.cwd();
const cli = path.join(repo, 'packages/cli/dist/cli.js');
if (!fs.existsSync(cli)) {
  console.error('build first: pnpm install && pnpm -r build');
  process.exit(1);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-demo-'));
fs.cpSync(path.join(repo, 'examples/refund-demo/before'), root, { recursive: true });
const git = (...a) => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.com', ...a], { cwd: root, stdio: 'pipe' });
git('init', '-q', '-b', 'main');
git('add', '-A');
git('commit', '-q', '-m', 'before the refund feature');

const bp = (...a) => {
  const r = spawnSync(process.execPath, [cli, ...a, '--root', root], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`blueprint ${a.join(' ')} failed:\n${r.stderr}`);
  return r.stdout;
};

bp('plan', 'new', 'refund-support', '--title', 'refund support');
for (const f of ['src/refunds.ts', 'src/api/refundHandler.ts', 'src/orders.ts']) {
  bp('plan', 'add', 'refund-support', f, '--from', path.join(repo, 'examples/refund-demo/after', f));
}
bp('plan', 'claim', 'refund-support', 'src/api/refundHandler.ts::refundHandler', 'src/audit/log.ts::recordAudit', '--note', 'audit refund.requested before refunding');
bp('plan', 'ready', 'refund-support');

console.log(`\nDemo project: ${root}\n`);
console.log('What to try:');
console.log('  1. In the browser: you are on "Claude\'s plan" and the card says it is ready for review.');
console.log('  2. Zoom into orders.ts: the OrderStatus line change and the new restock method are marked.');
console.log('  3. The window is read only. Answer in a terminal, from that folder:');
console.log(`       node ${cli} plan approve refund-support    (or: plan changes refund-support --note "...")`);
console.log(`       cd ${root}`);
console.log(`       node ${cli} plan apply refund-support`);
console.log(`       node ${cli} check`);
console.log('     Then click "After applying": 9 of 10 confirmed, one call not in the code.');
console.log('\nCtrl-C stops the server and deletes the demo.\n');

const watcher = spawn(process.execPath, [cli, 'watch', '--root', root], { cwd: root, stdio: 'inherit' });
const done = () => {
  watcher.kill('SIGINT');
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', done);
process.on('SIGTERM', done);
watcher.on('exit', () => {
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(0);
});
