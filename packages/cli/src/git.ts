import { spawnSync } from 'node:child_process';

// thin git helpers. everything runs with cwd = project root, so paths come back relative to it.

function git(root: string, args: string[], input?: string): { ok: boolean; out: Buffer } {
  const r = spawnSync('git', args, { cwd: root, input, maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? Buffer.alloc(0) };
}

// current HEAD commit, or null when this isn't a git repo or has no commits
export function headSha(root: string): string | null {
  const r = git(root, ['rev-parse', 'HEAD']);
  return r.ok ? r.out.toString('utf8').trim() : null;
}

// files in HEAD under root, as paths relative to root, with contents
export function headFiles(root: string, want: (rel: string) => boolean): Map<string, string> {
  const out = new Map<string, string>();
  const ls = git(root, ['ls-tree', '-r', '--name-only', '-z', 'HEAD']);
  if (!ls.ok) return out;
  const paths = ls.out
    .toString('utf8')
    .split('\0')
    .filter((p) => p && want(p));
  if (!paths.length) return out;

  // one cat-file process for all of them, instead of one `git show` each
  const req = paths.map((p) => `HEAD:./${p}`).join('\n') + '\n';
  const cat = git(root, ['cat-file', '--batch'], req);
  if (!cat.ok) return out;
  const buf = cat.out;
  let at = 0;
  for (const p of paths) {
    const nl = buf.indexOf(0x0a, at);
    if (nl < 0) break;
    const header = buf.subarray(at, nl).toString('utf8').split(' ');
    at = nl + 1;
    if (header[1] !== 'blob') continue; // missing or not a file
    const size = Number(header[2]);
    out.set(p, buf.subarray(at, at + size).toString('utf8'));
    at += size + 1;
  }
  return out;
}
