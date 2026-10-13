# Blueprint

A zoomable map of your codebase, made of real code. Zoomed out you see files and the arrows between them. Zoomed in you see the exact code, line for line, cut into blocks with arrows from each call to the thing it calls.

Its main job is planning features with Claude. The plan lands on the map as an overlay (new files, changed files, exact added and removed lines). After the edit is applied, the parser re-reads the real code and checks every planned arrow: confirmed, or not in the code.

> See the feature before Claude builds it, then see what it actually built.

## Status

**Early.** Nothing is published to npm. Today it can:

- `blueprint` (or `blueprint watch`): serve a live map of your project on `127.0.0.1`, zoomable from files down to exact code, with arrows from each call line to the thing it calls. It re-parses on save and shows what changed against your last commit.
- `blueprint print <file>`: the same facts as a text tree, or json, for use in a terminal or in chat.

You can use both any time, for any question about your code. They do not need a feature plan. The plan-then-check loop (draft a feature, review it on the map, then check what got built) is what comes next, not built yet. The roadmap and every design decision live in [docs/CONTEXT.md](docs/CONTEXT.md).

Work happens on the `dev` branch.

## Try it

```bash
pnpm install
pnpm -r build
cd examples/orders-demo
node ../../packages/cli/dist/cli.js            # opens the map in your browser
node ../../packages/cli/dist/cli.js print src/orders.ts
```

```
processOrder  src/orders.ts:68
├─ calculateOrderTotal  :49
│  ├─ roundMoney  src/utils/money.ts:2
│  └─ Inventory.getProduct  :28
├─ reserveOrderStock  :59
│  └─ Inventory.reserve  :38
│     └─ Inventory.getProduct  :28 (above)
└─ recordAudit  src/audit/log.ts:7
```

A leading `:` means the line is in the same file as the parent. `--json` gives the same data, `--depth 2` expands callees in other files, tests are skipped unless you pass `--include-tests`.

The map server binds to `127.0.0.1` only, checks the `Host` header, and needs the random token printed in its URL. Nothing leaves your machine, and there is no telemetry.

## How it works

The user flows and screen references are in [docs/visuals](docs/visuals/README.md).

The parser produces every block, line and solid arrow as fact. The model only plans, orders and narrates, and anything it claims is drawn dashed until the parser confirms it. Everything runs locally.

## Limits

Blueprint is honest about what a static parser can't see. v1 targets TypeScript and JavaScript through the TypeScript compiler API, and:

- Dynamic dispatch (interface method calls) resolves to the interface declaration, not the implementations.
- Calls through `any`, string-keyed access and DI containers can't be resolved, and are shown as unresolved.
- Line-level diffing is O(m*n). Fine per block, and whole files over a few thousand lines will need a Myers diff.
- Arrows are anchored by trimmed line text in the prototype, so the same line appearing twice in a block can collide. Exact line numbers are planned.
- Other languages come later through tree-sitter, with name-match edges labeled as lower confidence, never as checker-grade facts.

## Develop

```bash
corepack enable
pnpm install
pnpm test
pnpm lint
```

Needs Node 20 or later. TypeScript is pinned to 5.x on purpose, the TS 7 native port has a different API.

`prototype/` is read-only reference code from the design session. It is not part of the workspace and is excluded from lint and tests.

## License

MIT
