# Blueprint

A zoomable map of your codebase, made of real code. Zoomed out you see files and the arrows between them. Zoomed in you see the exact code, line for line, cut into blocks with arrows from each call to the thing it calls.

Its main job is planning features with Claude. The plan lands on the map as an overlay (new files, changed files, exact added and removed lines). After the edit is applied, the parser re-reads the real code and checks every planned arrow: confirmed, or not in the code.

> See the feature before Claude builds it, then see what it actually built.

## Status

**Early.** Nothing is published to npm. Today it can:

- `blueprint` (or `blueprint watch`): serve a live map of your project on `127.0.0.1`, zoomable from files down to exact code, with arrows from each call line to the thing it calls. It re-parses on save and shows what changed against your last commit.
- `blueprint print <file>`: the same facts as a text tree, or json, for use in a terminal or in chat.

You can use both any time, for any question about your code. They do not need a feature plan.

The plan-then-check loop is built too, from the terminal and on the map:

```bash
blueprint plan new refund-support --title "refund support"
blueprint plan add refund-support src/refunds.ts --from /tmp/refunds.ts    # or pipe the draft on stdin
blueprint plan claim refund-support src/api/h.ts::handler src/audit/log.ts::recordAudit
blueprint plan show          # new files, exact changed lines, proposed arrows
blueprint plan apply refund-support
blueprint check              # 9 of 10 planned arrows confirmed, one not in the code
```

A draft is parsed as an overlay on your real files and never touches them until you apply. If Claude marks a plan `ready`, the plan view shows Approve and Ask for changes, and `plan apply` waits for your go. Plans nobody marked ready apply exactly as before. Arrows the parser reads from draft code are dashed green, claims (calls the plan says will exist but no draft contains) are dashed with a hollow head, and after applying each one is confirmed, missing ("not in the code") or unplanned. 
## Share a map

```bash
blueprint snapshot --out map.html          # newest plan and one hop around it
blueprint snapshot --all --out map.html    # the whole project
```

One HTML file with the page, fonts and data inside. No server, no network, works from `file://`, and it stays small enough to publish as an artifact. It is a snapshot, not live.

## Use it from Claude Code

```bash
blueprint skill install            # for you, into ~/.claude/skills
blueprint skill install --project  # for this repo only, so a team shares it
```

Then in a new Claude Code session just ask. "What does src/orders.ts do?" runs `print` and answers from the parser's output. "Add refund support" makes Claude start the map, draft the feature as a plan, wait for your go, apply it and report the check honestly: how many planned arrows were confirmed, which weren't in the code, and what it added that nobody planned. The skill file is [skill/claude-code/SKILL.md](skill/claude-code/SKILL.md).

### In the Claude app

The app has no file watcher, so the skill in [skill/claude-app/SKILL.md](skill/claude-app/SKILL.md) works from snapshots: it builds the map with `blueprint snapshot`, publishes it as an artifact, and after you approve and it applies the change, republishes to the same URL with the check on it. It needs the code to be available (attached files, a repo, or a linked computer, where it will use the live watcher instead). `blueprint skill print --app` prints it.

The roadmap and every design decision live in [docs/CONTEXT.md](docs/CONTEXT.md).

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
