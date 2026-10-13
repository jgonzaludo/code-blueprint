import fs from 'node:fs';
import path from 'node:path';
import { planNeighbourhood, restrictGraph } from '@blueprint/core';
import { GraphBuilder } from './graph.js';
import { defaultUiDir } from './paths.js';
import { listPlans } from './plans.js';
import { computeState, type MapState } from './state.js';
import type { IO } from './run.js';

// one html file with the page, the fonts and the data inside it. no server, no network.
// escapes follow CONTEXT.md section 23: U+2028 and U+2029 break script bodies, and "</" ends them.
const jsonForScript = (v: unknown) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const jsForScript = (js: string) => js.replace(/<\/(script)/gi, '<\\/$1');

export function buildSnapshotHtml(state: MapState, uiDir = defaultUiDir): string {
  const read = (f: string) => fs.readFileSync(path.join(uiDir, f), 'utf8');
  let css = read('style.css');
  // fonts as data uris so the file works with nothing next to it
  css = css.replace(/url\('\/fonts\/([^']+)'\)/g, (_m, f: string) => {
    const b = fs.readFileSync(path.join(uiDir, 'fonts', f));
    return `url('data:font/woff2;base64,${b.toString('base64')}')`;
  });
  let html = read('index.html');
  html = html.replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${css}\n</style>`);
  // the data tag has to come before the app script, which reads it on load
  html = html.replace(
    '<script src="/app.js"></script>',
    () => `<script type="application/json" id="bp-data">${jsonForScript(state)}</script>\n<script>\n${jsForScript(read('app.js'))}\n</script>`,
  );
  return html;
}

export async function snapshotCommand(
  o: { root: string; out?: string; plan?: string; all: boolean; includeTests: boolean; baseline: 'HEAD' | 'disk' },
  io: IO,
): Promise<number> {
  if (!fs.existsSync(path.join(defaultUiDir, 'index.html'))) {
    io.err('blueprint: the ui bundle is missing. run the build first (pnpm build)\n');
    return 1;
  }
  if (o.plan && !listPlans(o.root).some((p) => p.id === o.plan)) {
    io.err(`blueprint: no plan '${o.plan}' here. try: blueprint plan list\n`);
    return 1;
  }
  const builder = new GraphBuilder({ root: o.root, baseline: o.baseline, includeTests: o.includeTests });
  // read the layout cache but never write it, a snapshot must not move anything on a live map
  const next = await computeState(builder, { root: o.root, includeTests: o.includeTests, planId: o.plan, writeCache: false });
  let state: MapState = { rev: 1, ...next };

  // small by default: the plan's files plus one hop, so an artifact stays light on big repos
  if (state.plan && !o.all) {
    const planFiles = [...Object.keys(state.plan.planGraph.fstat).filter((f) => state.plan?.planGraph.fstat[f] !== 'same'), ...Object.keys(state.plan.appliedGraph.fstat).filter((f) => state.plan?.appliedGraph.fstat[f] !== 'same')];
    const keep = planNeighbourhood(state.plan.planGraph, planFiles);
    for (const f of planNeighbourhood(state.plan.appliedGraph, planFiles)) keep.add(f);
    const pick = (g: typeof state.graph) => restrictGraph(g, keep);
    const positions = Object.fromEntries(Object.entries(state.positions).filter(([f]) => keep.has(f)));
    state = {
      ...state,
      graph: pick(state.graph),
      positions,
      plan: {
        ...state.plan,
        planGraph: pick(state.plan.planGraph),
        appliedGraph: pick(state.plan.appliedGraph),
        positions: Object.fromEntries(Object.entries(state.plan.positions).filter(([f]) => keep.has(f))),
      },
    };
  }

  const html = buildSnapshotHtml(state);
  const out = path.resolve(io.cwd, o.out ?? 'blueprint-map.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  const mb = html.length / (1024 * 1024);
  io.out(`blueprint  wrote ${out} (${mb.toFixed(2)} MB, ${Object.keys(state.graph.fstat).length} files${state.plan ? `, plan '${state.plan.id}'` : ''})\n`);
  if (mb > 5) io.err('blueprint: that is a big file. pass a plan so only its files and one hop are included, or share it as a file instead of an artifact\n');
  return 0;
}
