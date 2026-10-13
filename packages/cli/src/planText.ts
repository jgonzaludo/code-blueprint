import path from 'node:path';
import type { CheckResult, Graph, PlanFile } from '@blueprint/core';

// text surfaces for plan show and check, CONTEXT.md section 13. ascii plus a few box glyphs only.

const base = (f: string) => path.posix.basename(f);
const short = (id: string) => id.split('::')[1] ?? id;
const fileOf = (id: string) => id.split('::')[0] as string;
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

function lineSpan(g: Graph, id: string): string {
  const ns = (g.blocks[id]?.lines ?? []).map((l) => l.n).filter((n): n is number => n !== null);
  return ns.length ? `${Math.min(...ns)}-${Math.max(...ns)}` : '?';
}

export function renderPlanShow(g: Graph, plan: PlanFile, state: 'proposed' | 'applied'): string {
  const out: string[] = [];
  out.push(`PLAN  ${plan.title}   ${state === 'applied' ? 'applied, the files match the draft' : 'proposed, nothing written yet'}`);

  const files = Object.keys(g.fstat).filter((f) => g.fstat[f] !== 'same').sort();
  const blocksOf = (f: string) =>
    Object.values(g.blocks)
      .filter((b) => b.file === f && b.kind !== 'imports')
      .sort((a, b) => (a.lines[0]?.n ?? a.lines[0]?.o ?? 0) - (b.lines[0]?.n ?? b.lines[0]?.o ?? 0));

  // names an arrow lands on, with claims marked so nobody mistakes them for parsed facts
  const callees = (id: string): string => {
    const names: string[] = [];
    for (const e of g.edges) {
      if (e.from !== id || e.status === 'del') continue;
      if (e.status !== 'new' && !(e.source === 'claim')) continue;
      const n = short(e.to) + (e.source === 'claim' ? '? (claim)' : '');
      if (!names.includes(n)) names.push(n);
    }
    return names.join(', ');
  };

  const width = Math.max(10, ...files.flatMap((f) => blocksOf(f).map((b) => b.name.length)));
  for (const f of files) {
    const s = g.fstat[f];
    if (s === 'new') {
      out.push(`+ ${f}  NEW`);
      for (const b of blocksOf(f)) {
        const c = callees(b.id);
        out.push(`    + ${pad(b.name, width)}${c ? `  -> ${c}` : ''}`);
      }
    } else if (s === 'del') {
      out.push(`- ${f}  DELETED`);
    } else {
      const changed = blocksOf(f).filter((b) => b.status !== 'same');
      out.push(`~ ${f}  MODIFIED, ${changed.length} block${changed.length === 1 ? '' : 's'}`);
      for (const b of changed) {
        out.push(`    ${b.status === 'new' ? '+' : b.status === 'del' ? '-' : '~'} ${b.name}  lines ${lineSpan(g, b.id)}`);
        const diff = b.lines.filter((l) => l.d !== ' ');
        for (const l of diff.slice(0, 12)) {
          const num = l.d === '-' ? l.o : l.n;
          out.push(`      ${String(num ?? '').padStart(5)} ${l.d}  ${l.t}`);
        }
        if (diff.length > 12) out.push(`      ... ${diff.length - 12} more changed lines`);
      }
    }
  }

  // unchanged files the new code calls into
  const touched = new Set<string>();
  for (const e of g.edges) {
    if (e.status !== 'new' && e.source !== 'claim') continue;
    const f = fileOf(e.to);
    if (g.fstat[f] === 'same') touched.add(f);
  }
  if (touched.size) out.push(`  used by the new code, unchanged: ${[...touched].sort().map((f) => f.replace(/^src\//, '')).join(', ')}`);

  const claims = g.edges.filter((e) => e.source === 'claim').length;
  const proposed = g.edges.filter((e) => e.status === 'new' && e.source === 'parser').length;
  out.push('');
  out.push(`${proposed} arrows come from the draft code (parser facts), ${claims} are claims (not in any draft file).`);
  return out.join('\n');
}

export function renderCheck(r: CheckResult): string {
  const out: string[] = [];
  out.push('CHECK  parser re-read the code');
  out.push(`${r.summary.confirmed} of ${r.summary.planned} planned arrows confirmed`);
  const label = (e: { from: string; to: string }) => `${base(fileOf(e.from))} ${short(e.from)} -> ${short(e.to)}`;
  const order = { confirmed: 0, missing: 1, unplanned: 2 } as const;
  for (const e of [...r.edges].sort((a, b) => order[a.check] - order[b.check] || label(a).localeCompare(label(b)))) {
    const mark = e.check === 'confirmed' ? '[ok]' : e.check === 'missing' ? '[x] ' : '[?] ';
    const note = e.check === 'missing' ? '  not in the code' : e.check === 'unplanned' ? '  unplanned' : '';
    const claim = e.source === 'claim' ? '  (claim)' : '';
    out.push(`  ${mark} ${label(e)}${note}${claim}`);
  }
  for (const id of r.blocks.missing) out.push(`  [x]  ${id}  planned block not in the code`);
  for (const id of r.blocks.extra) out.push(`  [?]  ${id}  new block nobody planned`);
  return out.join('\n');
}

export function renderPlanList(plans: PlanFile[]): string {
  if (!plans.length) return 'no plans yet';
  return plans
    .map((p) => `${pad(p.id, 24)} ${p.title}  (${p.files.length} files, ${p.claims.length} claims)`)
    .join('\n');
}
