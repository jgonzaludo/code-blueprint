# Blueprint

A zoomable map of your codebase, made of real code. Zoomed out you see files and the arrows between them. Zoomed in you see the exact code, line for line, cut into blocks with arrows from each call to the thing it calls.

Its main job is planning features with Claude. The plan lands on the map as an overlay (new files, changed files, exact added and removed lines). After the edit is applied, the parser re-reads the real code and checks every planned arrow: confirmed, or not in the code.

> See the feature before Claude builds it, then see what it actually built.

## Status

**Early.** Nothing is published to npm and there is no usable CLI or UI yet. Right now the repo holds the core parser, ported from a design-session prototype, with a golden test on a small demo project. The roadmap and every design decision live in [docs/CONTEXT.md](docs/CONTEXT.md).

## How it works

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
