# Blueprint: full context dump

> Hand this file to Claude Code at the start of the repo. It holds everything decided so far: what the tool is, why each call was made, the data model, how the prototype works, what is still open, and the build order. A zip of the working prototype code ships next to it (`blueprint-prototype.zip`, mapped in section 22).

---

## 0. TL;DR

**Blueprint shows your codebase as a zoomable map of real code.** Zoomed out, it's files with arrows between them. Zoomed in, it's the exact code, line for line, cut into blocks (functions, classes, types) with arrows from the line that makes a call to the thing it calls.

**Its main job is planning features with Claude.** When you ask Claude for a feature, the plan lands on the map as an overlay:
- new files appear in a band above the project
- changed files get badges
- zooming in shows the exact added and removed lines plus new "slots" (for example a new method inside an existing class)

After Claude applies the edit, the parser re-reads the real code and checks Claude's planned arrows. Each one shows as **confirmed** or **not in the code**.

**It's a live window.** A local watcher process re-parses on save and pushes updates to a browser tab (auto-opened, like Vite does) or to a terminal pane. Claude Code starts the watcher through a skill. In the Claude app without a linked computer, the fallback is a static snapshot published as an artifact.

**Core rule:** the parser produces every block, line and arrow you see as fact. The model only plans, orders and narrates. Anything the model claims is drawn as a claim (dashed) until the parser confirms it.

- Brand: **Blueprint**
- npm package: `code-blueprint`, free when checked on 2026-10-13, so recheck before publishing
- Installed command: `blueprint` (single bin, so `npx code-blueprint` runs it too). A `bp` alias was dropped on 2026-10-13.
- Language support in v1: TypeScript and JavaScript, using the TypeScript compiler API

---

## 1. Origin and how the idea evolved

It started from a reel by a creator named James. The reel showed code cut into real code blocks with arrows for what uses what, laid out as a storyline that starts at the entry function. The working name was "Code Storyline". The reel's exact content wasn't saved, so the description above is all that's kept.

How the idea changed over the design session, in order. Each step is a decision that still holds unless a later step overrides it.

1. **Per-file storyline.** One TS file becomes draggable blocks, and a class acts as a container that holds its members. Arrows start at the calling line. Things defined in other files still show up as blocks, labeled with their origin path. This one-hop rule still applies inside a file view. Clicking a block opens an inspector with "Used by" and "Uses" lists, and there's a "Summarize usage" action.
2. **Real code, not boxes with names.** The blocks contain the actual source lines, dedented, with line numbers.
3. **Lightweight and on demand.** Repo-wide dependencies show only when asked for. Opening it should be as low-friction as possible, and it shouldn't be VS Code only, since not everyone uses VS Code.
4. **Project level, used mainly for features.** The scope moved from one file to a zoomable map of the whole project: map, then files, then exact code. The main moment of use is asking Claude something or drafting a feature. The plan draws onto the map: new files go in a band at the top, existing files get change badges, and zooming in shows exact changed lines and new slots.
5. **Exact, line for line.** No summarized code anywhere on the canvas. Close zoom shows the file exactly as it is on disk, or as it would be after the plan.
6. **Live window.** It should update as files change. In a terminal that's a second pane. In Claude Code, Claude opens a browser window. In the Claude app, a skill makes an artifact, which is a snapshot, not live (section 5).
7. **One real build, thin surfaces.** One core (parser plus watcher plus the map page), with surfaces on top: the Claude skill, the browser tab, an optional TUI, and an optional VS Code extension later.

---

## 2. What it is and isn't

**It is:**
- a deterministic structure view (parser-derived blocks, lines and call arrows)
- a plan overlay for AI-drafted features, plus a check after they're applied
- a live local window that follows the repo while you and Claude edit
- editor-agnostic: a browser tab or terminal pane next to any editor

**It isn't:**
- an IDE or editor. You never edit code in Blueprint.
- an AI code explainer that invents structure. The model never draws an arrow that's presented as fact.
- a full call-graph analyzer for every language. v1 is TS/JS only, with honest limits (section 8.5).
- a hosted service. Everything runs locally, and no code leaves the machine except what the user sends to Claude anyway.

---

## 3. Principles (the tie-breakers)

1. **Parser is truth, model is narrator.** Blocks, lines and solid arrows come from the parser. Claude can choose what to show, the order, and the words. Plan arrows that aren't backed by parsed draft code are dashed claims.
2. **Exact code.** Never paraphrase code on the canvas. If a block is too long, it scrolls or collapses with a line count. It's never rewritten.
3. **Don't move what's already there.** A plan overlay adds a new band and badges. It must not reshuffle the existing map, because people learn where things are spatially.
4. **On demand.** Default views are narrow: the files touched, plus one hop out. Whole-repo views are opt-in.
5. **Least friction.** One command, or zero if Claude starts it. No account, no config file needed.
6. **Be honest about limits.** Unresolved calls, dynamic dispatch and unsupported languages are labeled ("not resolved", "name match only"), never drawn as solid facts.
7. **Local and private.** Bind to 127.0.0.1 only. No telemetry by default.

---

## 4. User flows

### 4.1 Ask about code
"What does src/orders.ts do?" Claude runs `blueprint print src/orders.ts`, or the skill does it for you. You get a text tree in chat: the entry function, the call order, which calls leave the file, with paths and line numbers. If the watcher is running, the map tab also jumps to that file.

### 4.2 Draft a feature (the main flow)
1. You say "add refund support. Refund a paid order, put its items back in stock, and write an audit entry."
2. Claude drafts the change. With the skill, it writes the draft into a plan (section 9) instead of editing files directly. Or, in Claude Code plan mode, the plan is posted alongside.
3. The watcher parses the draft as an overlay on the current repo. The map switches to plan view:
   - **New files band at the top:** `src/refunds.ts` (3 blocks), `src/api/refundHandler.ts` (2 blocks). Dashed green borders, labeled "proposed".
   - **Changed files badged:** `orders.ts` shows "~2 modified, +1 new slot".
   - **Used-by badges:** `money.ts` and `log.ts` are unchanged, but the new code calls them.
   - **Zoom in:** the exact diff inside each block. `OrderStatus` gets `| "refunded"`, and `Inventory` gets a new `restock` method slot.
   - **Dashed arrows** for proposed calls.
4. You review the plan visually and say "go".
5. Claude writes the files. The watcher re-parses and runs the **check**. Arrows confirmed by the real code turn solid. Planned arrows missing from the code show as "not in the code". Calls in the code that the plan didn't predict show as "unplanned".
6. Claude reports the result in chat, e.g. "9 of 10 confirmed. Not in the code: refundHandler -> recordAudit." Then it asks whether to fix the code or drop the arrow from the plan.

### 4.3 Live while editing
The map tab is open. You save a file, it re-parses within about 200 ms on small repos, and changed blocks pulse or get badges compared with a baseline (git HEAD by default).

---

## 5. Surfaces and the decisions behind them

There is one real build. Most of the work is the core parser plus the watcher and the map page. The surfaces are thin.

| Surface | What it is | Live? | Priority |
|---|---|---|---|
| **Browser tab** (`blueprint` / `npx code-blueprint`) | Local server with the Plan Map page and live reload. Auto-opens the default browser. | Yes | v1, main surface |
| **Claude Code skill** | A SKILL.md that tells Claude to start the watcher if needed, send plans, run checks, and print text trees in chat | Yes, through the watcher | v1 |
| **Claude app skill (snapshot)** | Same parser, run in Claude's sandbox. Outputs a single self-contained HTML file and publishes it as an artifact. Republished per turn for plan, then check. | No, snapshot per publish | v1.5 |
| **Terminal TUI** (`blueprint tui`) | Full-screen character-grid view for a second terminal pane | Yes | v2, optional |
| **VS Code extension** | Webview panel with the same page, CodeLens, click sync, inline proposed diffs. Also works in Cursor and Windsurf. | Yes | Later, only if people ask |

**Why each one:**
- **Live needs a local process.** That's where the files change. A cloud sandbox can't watch your disk, and an artifact page can't read local files. So the live surfaces all sit on a local watcher, and the artifact is the zero-install snapshot fallback.
- **The browser tab is the main window.** The OS open command (`open` on macOS, `xdg-open` on Linux, `start` on Windows) opens it from any terminal and any editor. It's the same page whether Claude or the user started it. The Claude desktop app also has a browser pane that Claude can drive, which is a nice extra. Don't depend on it, because availability varies by setup.
- **The VS Code extension is deferred** because the browser tab already sits next to VS Code, and Claude Code runs inside VS Code's terminal. The extension only adds polish: click-to-jump into the editor, CodeLens, inline decorations. Not worth it before v1 ships.
- **The TUI is optional** because the browser covers terminal users. It's for people who refuse a browser. Cell grids are good at boxes and bad at routing arrows, so the TUI lists arrows for the selected box instead of drawing them.
- **In the Claude app with a linked computer** (the desktop app bridge), Claude can run the watcher on the user's machine through its shell. That makes it the live path, not the snapshot path.

Mock pages exist for all four surfaces (section 22). They're design references, not specs to copy pixel for pixel.

---

## 6. Architecture

```
            +---------------------------- your machine -----------------------------+
            |                                                                       |
  editor -> |  files on disk --fs events--> WATCHER (blueprint)                     |
  Claude -> |                                 |  debounce 100-200 ms                |
            |                                 v                                     |
            |                          CORE: parse(project, overlay?) -> Graph      |
            |                                 |   TS program / language service     |
            |                                 |   blocks, lines, edges, fedges      |
            |                                 v                                     |
            |  .blueprint/plans/*  -----> PLAN ENGINE: diff(base, draft) + claims   |
            |                                 |   check(applied, draft)             |
            |                                 v                                     |
            |                          HTTP 127.0.0.1:4711  (+ SSE /api/events)     |
            |                            |                    |                     |
            |                       browser tab           TUI pane                  |
            |                       (Plan Map UI)         (blueprint tui)           |
            +-----------------------------------------------------------------------+

  Claude Code <-- skill --> CLI: blueprint print | plan | check | snapshot
  Claude app  <-- skill --> core in sandbox -> snapshot HTML -> artifact (no watcher)
```

Packages (monorepo, section 18):
- `@blueprint/core`: pure functions. Parse to Graph, line diffs, block diffs, edge diffs, plan check. No I/O beyond reading files through an injected file system, so the same core runs in the sandbox, in the CLI and in tests.
- `code-blueprint` (CLI): watcher, server, open, print, plan, check, snapshot.
- `@blueprint/ui`: the Plan Map page as a static bundle served by the CLI and inlined by `snapshot`.
- `@blueprint/tui`: later.
- `skill/`: SKILL.md for Claude Code, plus a variant for the Claude app.

---

## 7. Data model

These match what the prototype emits (`feat/data.json`), extended where noted with **NEW**.

```ts
type BlockId = string;              // "<relpath>::<name>", e.g. "src/orders.ts::Inventory"
type BlockKind = 'imports' | 'function' | 'class' | 'interface' | 'type'
               | 'const' | 'enum';  // NEW: const (arrow fns / exported consts), enum

type LineDiff = ' ' | '+' | '-';
interface Line {
  t: string;        // exact source text (blocks: dedented by the block's min indent; file text: verbatim)
  d: LineDiff;      // ' ' unchanged, '+' added, '-' removed (vs baseline)
  o: number | null; // line number in the baseline file (null for '+')
  n: number | null; // line number in the new/draft file (null for '-')
}

interface Member { name: string; line: number }   // class members: methods, ctor, props

interface Block {
  id: BlockId;
  file: string;               // repo-relative, forward slashes
  kind: BlockKind;
  name: string;
  status: 'same' | 'mod' | 'new' | 'del';
  lines: Line[];              // includes leading comment lines directly above the decl
  members: Member[];          // classes only
  exported?: boolean;         // NEW
  external?: { from: string } // NEW: block shown one hop out from another file (origin path label)
}

interface Edge {
  from: BlockId;              // block containing the call
  to: BlockId;                // block containing the callee's declaration (methods map to their class block)
  callText: string;           // trimmed source line of the call site (anchor for arrow start)
  targetText: string;         // trimmed source line of the callee declaration (anchor for arrow end)
  status: 'same' | 'new' | 'del';
  // NEW:
  callLine?: number;          // exact line numbers; prefer these over text anchors (see 8.5)
  targetLine?: number;
  source?: 'parser' | 'claim';            // claim = model-asserted, not in parsed code
  check?: 'confirmed' | 'missing' | 'unplanned'; // set after apply
  resolution?: 'checker' | 'name-match' | 'unresolved'; // how the target was found
}

interface FileEdge { from: string; to: string; status: 'same' | 'new' | 'del' } // from import resolution
type FileStat = Record<string, 'same' | 'mod' | 'new' | 'del'>;
type FileText = Record<string, Line[]>;  // whole-file line diff, used by editor views / TUI zoom

interface Graph {
  blocks: Record<BlockId, Block>;
  edges: Edge[];
  fedges: FileEdge[];
  fstat: FileStat;
  ftext: FileText;
  // NEW:
  meta?: { root: string; baseline: string /* "HEAD" | "disk" | planId */; parsedAt: string; files: number; ms: number };
  plan?: PlanInfo;
}

interface PlanInfo {          // NEW
  id: string; title: string;  // "refund support"
  state: 'proposed' | 'applied' | 'checked';
  claims: Edge[];             // model-asserted arrows not derivable from draft code (source: 'claim')
  summary?: { confirmed: number; missing: number; unplanned: number };
}
```

The refund demo, as numbers to use for golden tests: **24 blocks, 18 edges (9 new), 9 file edges**.
- `fstat`: `api/refundHandler.ts` and `refunds.ts` are new, `orders.ts` is mod, and checkout, retry, money and log are same.
- Modified blocks: `OrderStatus` (one line changed, shown as 1 minus and 1 plus) and `Inventory` (6 added lines for `restock`, counting a blank line).
- `orders.ts` whole-file diff: +7 -1.

---

## 8. Parser (core)

### 8.1 What the prototype does (`prototype/feat/build3.js`, about 120 lines)
- **TypeScript 5.9 compiler API.** Pin 5.x. TypeScript 7, the native Go port, has a different API, and the JS API broke against it in testing.
- **Program options:** `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `strict`, `noEmit`, `skipLibCheck`, `lib: [lib.es2022.d.ts, lib.dom.d.ts]` (dom is needed for `console`). The real build should load the project's `tsconfig.json` with `ts.getParsedCommandLineOfConfigFile` and fall back to these defaults.
- **Blocks,** from top-level statements of each source file:
  - All `import` declarations become one `imports` block, spanning first to last import.
  - Named `class` declarations become a `class` block. Members are listed with their line numbers: ctor, methods, props.
  - Named `function` declarations become a `function` block. This includes `declare function`.
  - `interface` and `type` aliases become blocks of those kinds.
  - Leading comment lines directly above a declaration are included (walk up while the line matches `^\s*(//|/\*|\*)`).
  - Code is sliced verbatim, then dedented by the minimum indent of non-blank lines.
- **Call edges.** Walk every identifier inside each block node:
  - Skip declaration names: params, vars, the block's own name, method and property names.
  - For `a.b()`, use the property-access node. Only count it when the node is the `expression` of a `CallExpression`.
  - `checker.getSymbolAtLocation(id)`. If it's an alias (an import), use `checker.getAliasedSymbol`.
  - For each declaration of the symbol in a project file, find the block whose node range contains the declaration. Methods resolve to their class block. That's the target. Skip self-edges.
  - The edge stores `callText` (trimmed call line) and `targetText` (trimmed declaration line). It's deduped on `from|to|callText`.
- **File edges** come from `ts.resolveModuleName` on each import specifier, kept when the result is a project file.
- **Type errors abort** the build. The prototype requires a clean type-check. The real build must not (see 8.4).

### 8.2 Diffs and statuses
- **Block identity** is `file::name`. A block in after but not before is `new`. In before but not after, it's `del`. In both, its lines go through an LCS line diff. Any non-space line makes it `mod`, otherwise it's `same`.
- **Line numbers:** `o = before.start + i`, `n = after.start + j`.
- **Edges:** key is `from|to|callText`. Present in both means `same`, only in after means `new`, only in before means `del`.
- **File status:** `new` if the file isn't in before. `mod` if any block isn't `same`. Otherwise `same`. Gap: a file with only non-block changes, like top-level statements, reads as `same`. Fix that by also diffing the whole file text.
- **`ftext`:** whole-file LCS with 1-based `o` and `n`.

### 8.3 Must-add for real repos
1. **More block kinds:**
   - `export const x = () => {}` and `const x = function`, as kind `const` with the function body. This is the biggest gap, since modern TS uses arrow functions everywhere.
   - Exported object or array consts.
   - `enum`.
   - `export default function` and `export default class`, named `default` with the file name in the label.
   - Namespaces, which are rare.
   - Top-level statements that aren't declarations go into a `module` block, so nothing in the file is invisible.
2. **More edge kinds:**
   - `new X()` (`NewExpression`)
   - JSX `<Comp/>`, which counts as a "renders" edge
   - Callbacks passed as values (`arr.map(fn)`), which are reference edges, drawn lighter
   - Type references, as a separate optional "types" layer, off by default (the early prototype accidentally drew these as calls, and that was removed)
   - Re-exports (`export * from`), followed through to the real declaration
   - Calls to `node_modules` symbols, summarized as an external package badge, not drawn per call
3. **Exact anchors.** Store `callLine` and `targetLine` (numbers). The prototype anchors arrows by matching trimmed text, which breaks when the same line text appears twice in a block. Keep `callText` for display and for matching across versions.
4. **Incremental parsing:**
   - Keep one `ts.LanguageService` (or `ts.createWatchProgram` / `BuilderProgram`) alive in the watcher. Re-parse only changed files and their dependents.
   - The prototype finds the target block with a linear scan over all nodes per call. Replace it with a per-file interval index.
5. **Baseline.** Default baseline is git `HEAD`: read old versions with `git show HEAD:path`. For plans, the baseline is the current disk and the "after" is disk plus the draft overlay.
6. **Overlay file system.** `parse(root, overlay: Map<path, content | null>)`: a custom `CompilerHost` or `LanguageServiceHost` that serves overlay contents first. That's how drafts get parsed without touching disk.

### 8.4 Robustness
- Never require a clean type-check. Parse with errors and surface a count ("12 type errors, arrows may be incomplete"). The checker still resolves most symbols with errors present.
- Size caps: skip files over about 5k lines or minified files. Ignore `node_modules`, `dist`, `build`, `.next`, `coverage`, and anything in `.gitignore`.
- Monorepos: support multiple tsconfigs (project references) later. For v1, pick the nearest `tsconfig.json` to the cwd.
- JS: same pipeline with `allowJs` and `checkJs: false`. Arrows are weaker without types, so mark `resolution: 'name-match'` when the checker can't resolve.

### 8.5 Known limits to state in the README
- Dynamic dispatch (interface method calls) resolves to the interface declaration, not the implementations. Optionally add a "go to implementations" lookup on click through the language service, with a cap.
- Calls through `any`, string-keyed access and DI containers can't be resolved, and are shown as unresolved.
- Line-level LCS is O(m*n). Fine per block. For whole files over a few thousand lines, switch to Myers diff (`diff` package).
- Text-anchor collisions (see 8.3, item 3).
- Other languages: later, through tree-sitter with name-match edges explicitly labeled lower confidence. Never present those as checker-grade facts.

### 8.6 Other prototype parser notes
- `parse2.js` is the earlier per-file parser. It emits a single file's blocks plus one-hop external blocks with an origin path, for the "Storyline Canvas" per-file view.
- `typescript` is resolved from `prototype/parser/node_modules`. In the repo it's a normal dependency.

---

## 9. Plan protocol (how Claude's plan reaches the map)

### 9.1 Recommended design: drafts, not descriptions
In the prototype, the plan was hand-staged data, with one fake arrow to demo the check. The real design should make plans parser-derived too:

1. **Claude writes a draft:** the full proposed contents of each new or changed file into `.blueprint/plans/<planId>/files/<relpath>`, with deletes listed in `plan.json`. It never writes over the real files at this stage.
2. **`plan.json`:**
   ```json
   { "id": "refund-support", "title": "refund support", "created": "2026-10-13T19:41:00Z",
     "files": ["src/refunds.ts", "src/api/refundHandler.ts", "src/orders.ts"], "delete": [],
     "claims": [ { "from": "src/api/refundHandler.ts::refundHandler", "to": "src/audit/log.ts::recordAudit",
                   "note": "audit refund.requested before refunding" } ] }
   ```
3. **The watcher sees the plan dir change.** It runs `parse(root, overlay=draft)`, then diffs disk against draft. That gives every new block, exact changed line and new or changed arrow, all parser-derived. In plan view those are drawn dashed ("proposed"), because they're not on disk yet.
4. **`claims`** are for arrows Claude intends but didn't write in the draft yet, such as a stub. They're drawn dashed with a "claim" marker, and are never presented as parsed.
5. **Apply:** Claude, or the user, copies the draft into the real files. Claude Code just edits normally. The CLI also offers `blueprint plan apply` for a straight copy.
6. **Check:** after the next parse of disk, compare the applied graph with the draft graph plus claims:
   - `confirmed`: the edge is in the draft or claims, and in applied
   - `missing` ("not in the code"): the edge is in the draft or claims, but not in applied
   - `unplanned`: the edge is in applied but in neither the draft nor the claims, among edges touching planned files
   - Block-level drift works the same way: planned blocks missing, or extra blocks added.
7. **Claude reads the check** (`blueprint check --json`) and reports it in chat.

Why drafts: it keeps principle 1 (parser is truth) even before the code exists, and it gives exact lines for free. In the prototype's flow, the plan was a set of claims. This design makes almost everything parsed, and only the leftover intent is a claim. **Open question for Joe:** whether a lighter "intent-only" plan (file list plus block signatures plus claimed arrows, no full bodies) is also needed, for very early sketching. It would render as slots with signatures and dashed claim arrows.

### 9.2 Transport
File-based (`.blueprint/plans/`) is the primary transport. It works from any agent, needs no running server, and leaves an audit trail. As a convenience, if the watcher is running, `POST /api/plan` accepts the same JSON plus file contents inline. Add `.blueprint/` to `.gitignore` by default, but allow committing plans.

### 9.3 Claude Code plan mode
When the user is in Claude Code plan mode, the skill tells Claude to write the plan draft through Blueprint before exiting plan mode, so the user reviews the map and the plan text together. Verify how plan mode restricts file writes. Writing to `.blueprint/` may need an allow rule, or should go through the CLI (`blueprint plan add`).

---

## 10. Watcher and server (CLI)

### 10.1 Commands
```
blueprint                     # = blueprint watch --open
blueprint watch [--port 4711] [--no-open] [--baseline HEAD|disk] [--root .]
blueprint print <file|dir> [--depth 1] [--json]   # text tree for chat (no server needed)
blueprint plan new <id> [--title "..."]           # scaffold .blueprint/plans/<id>/
blueprint plan add <id> <file>                    # copy a draft file in (or read stdin)
blueprint plan show [id] [--json]                 # what the plan changes, text
blueprint plan apply <id>                         # copy draft files over real ones
blueprint check [id] [--json]                     # applied vs plan: confirmed/missing/unplanned
blueprint snapshot [--plan id] --out map.html     # single self-contained HTML (data inlined)
blueprint tui                                     # terminal view (later)
```
Every command that prints should support `--json` so Claude can parse it.

### 10.2 Watcher
- Use `chokidar` (or Node's `fs.watch` recursive, now supported on Linux in recent Node) on the root plus `.blueprint/plans/**`, with ignores from `.gitignore`.
- Debounce 100 to 200 ms, then do an incremental parse (8.3, item 4). Push the new Graph, or a patch, to clients.
- Baseline cache: git HEAD contents are read once per HEAD commit.
- Print a short status line per update: `blueprint  parsed 3 files in 41 ms  2 blocks changed`.

### 10.3 Server
- Bind to **127.0.0.1 only**. Default port 4711, falling back to the next free port.
- **Security:** a localhost server is reachable by any web page through the browser, and DNS rebinding is real. So:
  - check the `Host` header is `localhost:PORT` or `127.0.0.1:PORT`
  - put a random token in the opened URL (`/?t=...`) and require it on `/api/*` (cookie after the first load)
  - reject cross-origin POSTs
  - never serve files outside the root
- **Endpoints:**
  - `GET /` serves the UI
  - `GET /api/graph?plan=id` returns the Graph
  - `GET /api/events` is SSE for `graph`, `plan`, `check` events. SSE is simpler than websockets and good enough.
  - `POST /api/plan` is the convenience transport
  - Decided later: the window is read only, so there are no POST endpoints. Anything that changes state goes through the CLI, from chat or a terminal. Editor jumps belong to the VS Code extension.
- **Auto-open:** use the `open` npm package (wraps `open`, `xdg-open` and `start`). Skip it when `--no-open`, when `CI` is set, or when there's no display.

### 10.4 Snapshot (for the Claude app and sharing)
`blueprint snapshot` writes one HTML file with the UI bundle and Graph JSON inlined. No server, no network, works from `file://`.
- In the Claude app, the skill runs core in the sandbox, writes the snapshot, and publishes it as an artifact. After applying, it republishes to the same URL with the check.
- This needs the code in the sandbox: attached files, a cloned GitHub repo, or a linked computer.
- Watch for artifact size limits on big repos. Snapshot only the plan's files plus one hop.

---

## 11. The Plan Map UI (`@blueprint/ui`)

The working reference is `prototype/feat/pm.js` and `pm.css`, the page Joe approved ("this is great"). Rebuild it properly. Vanilla TS plus SVG is fine, and so is a small framework. No heavy canvas library is needed at this scale.

### 11.1 Semantic zoom
- **Camera:** `{x, y, s}` applied as a CSS `transform: translate(x,y) scale(s)` on one world element. Everything is absolutely positioned in world coordinates.
- **Level of detail (LOD):** below scale 0.5 is **map** mode: file cards as labeled silhouettes, block outlines only, file-level arrows. At 0.5 and up it's **code** mode: exact lines visible, block-level arrows. The label shows "Project map" below 0.5, "File" from 0.5 to 0.95, and "Code, line for line" at 0.95 and up.
- **Controls:**
  - drag to pan (pointer events, so touch works)
  - Ctrl or Cmd plus wheel to zoom at the cursor
  - +, - and Fit buttons
  - double-click a file to zoom to it
  - click a block to select it (and zoom with `goBlock`)
- Zoom limits are 0.12 to 2.2. Camera moves animate over about 700 ms with ease-out cubic, interpolating scale geometrically. Respect `prefers-reduced-motion`.
- Fit: `rectCam(rect, pad, maxScale)` fits a world rect into the viewport.

### 11.2 Layout
- **The prototype uses a hand-written `LAYOUT` array** (file positions and block columns). The real build needs auto-layout:
  - Files are containers, and blocks stack in columns inside them, column width 420, gap 16, padding 16, file header height 112 including badges.
  - File placement: layered by import direction (entry and API files left, leaves right). Use ELK (`elkjs`, layered algorithm, compound nodes) or dagre with clusters. ELK handles nested containers better.
- **Stability rule** (principle 3): cache the layout per repo in `.blueprint/layout.json`. A re-parse only places new things and never moves existing files, unless the user hits "Re-layout".
- **Plan band:** new files are placed in a band **above** the existing map, labeled "New files". Within the band, order follows the call direction.
- **New slots in existing files:** a new member inside an existing class (e.g. `Inventory.restock`) is shown inside its class block as added lines. A brand-new top-level block in an existing file gets a dashed slot at the end of its column.

### 11.3 Blocks and lines
- **Block header:** kind tag (function, class, interface, type, imports), name, status tag ("new (proposed)", "modified").
- **Lines:** a gutter with the old number for `-` lines and the new number otherwise, then syntax-highlighted text. Line height 14 px in world units, header height 26 px.
- **Diff colors:** `+` gets a green background, `-` gets red with strikethrough, and a modified block gets an amber border.
- **Base mode** hides `+` lines and new blocks. **Plan** and **applied** modes show everything.

### 11.4 Arrows
- **Block-level arrows** go from the call line (right edge of the source block, at that line's y) to the target declaration line (left edge of the target block). They're cubic curves routed around the source's column, with arrowheads.
- **File-level arrows** in map LOD go from file card to file card.
- **Styles:**
  - same: solid neutral
  - new and proposed: dashed green
  - new and confirmed (after applying): solid green
  - missing: red dashed with a "not in the code" label
  - unplanned: amber
  - claim: dashed with a hollow arrowhead
- On selection, other blocks dim, and only arrows touching the selection stay bright.

### 11.5 Panels
- **Inspector**, under the canvas: the selected block's kind, name, `file : line range`, and status chip. Then "Used by" and "Uses" lists, each item as `name L<line> <path>`, clickable.
  - "Summarize usage" sends the model **only parser facts** (the block's code plus the call-site lines of its callers and callees). The model writes a short summary. That happens through the skill or Claude, not inside the page. The page can show a "copy prompt" button, or call back to the CLI if an API key is configured, opt-in.
- **Side panel**, depending on mode:
  - **Current:** file count and a hint.
  - **Plan:** "New files, above the map" (with counts), "Changed files" (block names, e.g. "orders.ts Inventory, + restock slot"), "Used by the new code (unchanged)", and the note "N dashed arrows are Claude's claims... they stay dashed until the parser checks the real code."
  - **Applied:** the check box: "9 of 10 proposed arrows confirmed", then a list of missing ones with an explanation.
- **Mode switch:** "Current code / Claude's plan / After applying". In the live product this is driven by plan state, and the user can still toggle it to compare.

### 11.6 Theme
Light by default, dark through `prefers-color-scheme` and a `data-theme` override. Tokens are in `pm.css` (`--add`, `--del`, `--mod` and so on). Fonts are Schibsted Grotesk for the UI and JetBrains Mono for code. Bundle the fonts locally in the real build so it works offline.

### 11.7 Gotchas hit in the prototype
- The CSS class names `.code` and `.ln` are used by the world LOD and by code lines. Embedding the map inside another page (the VS Code mock) collided with host classes, and the map went blank. **Namespace all UI classes** (`bp-` prefix) or use shadow DOM.
- The inline data `<script type="application/json">` must come before the main script.
- Call `fitAll` again after layout settles and on `load`, because flex containers can report 0 height on first paint.

---

## 12. Claude skill

### 12.1 Claude Code skill (draft SKILL.md)
```markdown
---
name: blueprint
description: Show code structure and feature plans as a live map of real code. Use when the user asks what a file or feature does, asks to plan or draft a feature, or wants to see what a change touches.
---

# Blueprint

Blueprint parses the repo (TS/JS) into blocks of exact code with call arrows and serves a live map at localhost.

## Make sure the window is up
1. Check: `blueprint status --json` (running? port?)
2. If not running: `blueprint watch` in the background (it opens the browser). Tell the user in one line that the map is open.

## Explaining code
- `blueprint print <file> --json` gives entry points, call order, external calls with paths and lines.
- Answer from that output. Never describe a call that is not in it as fact.

## Planning a feature
1. Draft the full contents of each new/changed file.
2. `blueprint plan new <id> --title "<short title>"`, then `blueprint plan add <id> <file>` per file (stdin), and add `claims` only for calls you intend but did not write.
3. Tell the user: the plan is on the map (new files on top, changed files badged; zoom in for exact lines). Summarize in a short text tree from `blueprint plan show <id>`.
4. Wait for approval before editing real files.

## After applying
1. Make the edits (or `blueprint plan apply <id>`).
2. `blueprint check <id> --json`.
3. Report: "N of M planned arrows confirmed." List missing ("not in the code") and unplanned calls, then ask whether to fix the code or update the plan. Never claim confirmed arrows the check did not confirm.
```

### 12.2 Claude app skill (snapshot variant)
It uses the same steps, but there's no watcher:
- `npx code-blueprint snapshot --plan <id> --out blueprint.html`, then publish as an artifact.
- After applying, run `check` and republish to the same artifact URL.
- If the repo isn't available in the sandbox, ask for the files or a GitHub repo, and say plainly that the map can't be built without the code.
- If the desktop app is linked to the user's computer, prefer running the watcher there instead (live).

### 12.3 MCP server (optional)
The same commands can be exposed as MCP tools (`blueprint_print`, `blueprint_plan`, `blueprint_check`) for agents other than Claude Code. It's a thin wrapper over the CLI. Not needed for v1.

---

## 13. Text output format (`blueprint print`, `plan show`, `check`)

This is what the chat surfaces show. The Claude Code mock is the reference.

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

```
PLAN  refund support   proposed, nothing written yet
+ src/api/refundHandler.ts  NEW
    + refundHandler         -> loadOrder, refundOrder, recordAudit? (claim)
+ src/refunds.ts  NEW
    + calculateRefundTotal  -> roundMoney, Inventory
    + restockOrderItems     -> Inventory
    + refundOrder           -> calculateRefundTotal, roundMoney, restockOrderItems, recordAudit
~ src/orders.ts  MODIFIED, 2 blocks
    ~ OrderStatus  lines 4-4
         4 -  type OrderStatus = "pending" | "paid" | "shipped" | "cancelled";
         4 +  type OrderStatus = "pending" | "paid" | "shipped" | "cancelled" | "refunded";
    ~ Inventory  lines 25-53
        47 +
        48 +    restock(productId: string, quantity: number): void {
        ...
  used by the new code, unchanged: utils/money.ts, audit/log.ts
```

```
CHECK  parser re-read the code
9 of 10 planned arrows confirmed
  [ok] refunds.ts refundOrder -> recordAudit
  ...
  [x]  refundHandler.ts refundHandler -> recordAudit  not in the code
```

**Rules:**
- Plain ASCII plus box-drawing characters only. Fallback-font glyphs broke the alignment in the TUI mock.
- Paths are relative. A leading `:` means the line is in the same file.
- `(above)` marks a repeat instead of re-expanding it.
- `--json` emits the same structure as data.

---

## 14. Terminal TUI (later)

- A character grid with fixed width (prototype: 96 columns by 30 rows), rendered with a terminal UI library (`ink`, or `blessed`/`neo-blessed`). The mock is in `prototype/m2/b.html`.
- **Map screen:**
  - header (`storyline` title, view `[b]ase [p]lan [a]pplied`)
  - "NEW FILES" band on top, then "EXISTING"
  - file boxes 29 by 5, with dashed borders (`- - -` and `:`) for proposed files
  - `+`, `~` and blank prefix markers, and a meta line ("NEW 3 blocks", "MOD 2 blocks, +1 slot", "used by new code")
  - an info pane for the selected box with `calls` and `called by` lists, because the TUI doesn't draw arrows
- **File screen** (Enter):
  - the exact whole-file lines with number, mark and text, plus diff background colors
  - call lines get a suffix ` --> calleeName`
  - j and k to scroll, Esc to go back
- **Keys:** arrows move by geometry (nearest box in that direction), Enter zooms in, Esc zooms out, `b`, `p` and `a` set the view, `c` shows the check banner, `q` quits.
- It subscribes to the same watcher over SSE, or embeds core directly.

---

## 15. VS Code extension (later, polish only)

- A webview panel with the same UI bundle, connecting to the running watcher or starting one.
- CodeLens above each block: `N uses | M callers | Show on map`.
- Click sync both ways: map to editor reveals the range, editor cursor to map selects the block.
- Plan drafts shown as inline decorations (green and red line backgrounds) or through VS Code's diff editor against the draft file.
- Explorer badges: `A?` for proposed new files, `A` and `M` after applying.
- A status bar item: "Blueprint: plan ready (2 new, 1 changed)".
- **Ways to open:** status bar, CodeLens, editor title icon, command palette, and automatically when a plan arrives.
- Ships to the Open VSX registry as well, for Cursor and Windsurf.
- The mock is `prototype/m2/c.html`.

---

## 16. Competitive landscape

- **Etchpad (etchpad.ai):** researched during design. It's a waitlist-stage "spatial coding" ADE with a deterministic project diagram, semantic diff overlays and an AI walkthrough layer. It has the closest philosophy (deterministic structure plus AI on top).
  - **Blueprint's difference:** it isn't a new environment. It's a lightweight window next to whatever you already use, centered on exact code at close zoom and on the plan-then-check loop with Claude. It's open source.
- **Other nearby tools** (from general knowledge, not re-verified this session):
  - dependency-cruiser and Madge for module dependency graphs
  - Sourcetrail, an archived code-exploration tool
  - CodeSee, codebase maps (acquired, product changed)
  - IDE call hierarchy views
  None of them overlay an AI-drafted plan and then verify it.
- **Positioning line:** "See the feature before Claude builds it, then see what it actually built."

---

## 17. Naming

- **Brand: Blueprint.** A blueprint is the plan you draw before building, and also what you check the building against, so it matches plan then check. The look (real code blocks with arrows) also reads as a technical drawing.
- **npm:** `blueprint`, `blueprintjs`, `blueprint-cli` and `blueprint-ai` are taken. `blueprint-ai` is an agentic planning CLI, which is a similar space. `code-blueprint`, `blueprint-code`, `blueprint-map`, `blueprintmap`, `blueprint-live` and `blueprint-dev` were free on 2026-10-13. The pick is to **publish `code-blueprint`**, with a single `bin` entry, `blueprint`. A scoped `@<user>/blueprint` is the backup.
- **Search noise:** Palantir's Blueprint UI toolkit and Unreal Engine Blueprints dominate the results. Mitigate with the repo name `code-blueprint`, a clear tagline, and the README keywords "code map", "plan", "Claude", "TypeScript".
- **Still to do:** check that the GitHub repo name is free, skim for trademark conflicts, and recheck npm right before the first publish.
- **Runner-up:** `cyanotype`, the chemical process behind real blueprints. It's distinctive and free, but harder to type.
- **Earlier names:** "Code Storyline" and "Storyline". The prototype files and mocks still say "storyline". Rename everything to Blueprint in the repo.
- **Tagline options:**
  - "A live blueprint of your code: plan a feature as a map of real code, then check what actually got built."
  - "See the feature before Claude builds it."

---

## 18. Repo layout (suggested)

```
code-blueprint/
  package.json              # pnpm workspaces
  packages/
    core/                   # parse, diff, plan, check (pure, overlay FS) + tests
      src/parse.ts  src/blocks.ts  src/edges.ts  src/diff.ts  src/plan.ts  src/check.ts  src/types.ts
    cli/                    # bin: blueprint  (watch, server, print, plan, check, snapshot)
      src/watch.ts  src/server.ts  src/print.ts  src/open.ts  src/git.ts
    ui/                     # Plan Map page (vite build -> static assets; inlined for snapshot)
    tui/                    # later
  skill/
    claude-code/SKILL.md
    claude-app/SKILL.md
  examples/
    refund-demo/before/  refund-demo/after/   # from the prototype, golden test fixture
  fixtures/                 # tricky parser cases (arrow fns, re-exports, overloads, JSX, default exports)
  docs/  CONTEXT.md (this file)  ARCHITECTURE.md
  LICENSE                   # MIT suggested
```

- Node 20 or later, TypeScript strict, `vitest` for tests, `tsup` to bundle the CLI, `vite` for the UI.
- Keep core dependency-light: `typescript` (5.x, a peer or regular dependency) and `diff`.

---

## 19. Build order with acceptance criteria

Stages are named by feature, not by number. Each one is its own PR (or a few), and commits and PR titles follow Conventional Commits with these names as scopes where it helps (see CONTRIBUTING.md).

**scaffold:** Workspaces, lint, test, CI (GitHub Actions on Node 20 and 22). Port `build3.js` into `core` as a typed module.
- Done when: `pnpm test` reproduces the refund demo goldens (24 blocks, 18 edges, 9 new, fstat as in section 7).

**parser:** core parser, hardened.
- Done when:
  - 8.3 items 1, 3 and 6 are in
  - no clean type-check is required
  - fixtures pass for arrow-function consts, default exports, re-exports, `new X()` and class methods
  - it parses one real mid-size open source TS repo (pick something with about 200 files) in under 3 s cold, with arrows spot-checked by hand

**print:** `blueprint print`.
- Done when: the text tree in section 13 renders for a file, with `--json`. Usable from Claude Code immediately.

**live-map:** watcher, server and UI (the v1 window).
- Done when:
  - `npx code-blueprint` in a repo opens the browser to the map
  - saving a file updates the map in under about 300 ms on the demo
  - layout is stable across updates
  - the security checks from 10.3 are in
  - "click to open in editor" works through `code -g`

**plan-check:** plan and check.
- Done when:
  - `plan new`, `plan add`, `plan show` and `check` work
  - the map shows the plan band, badges, exact lines and dashed arrows
  - after applying, arrows turn solid and missing ones are flagged
  - the refund demo reproduces the "9 of 10" check: the plan claims `refundHandler -> recordAudit`, and the code doesn't have it

**claude-skill:** the Claude Code skill.
- Done when: in a fresh Claude Code session, "add X" leads to Claude starting the watcher, posting a draft plan, waiting, applying and reporting the check, without manual steps.

**snapshot:** snapshot and the Claude app skill.
- Done when: `blueprint snapshot` makes one HTML file that works from `file://`, and the Claude app skill publishes it as an artifact.

**later:** the TUI, more edge kinds (JSX, type layer), monorepo tsconfig references, the VS Code extension, tree-sitter languages.

---

## 20. Testing strategy

- **Golden tests:** `examples/refund-demo` before and after give the exact Graph JSON snapshot. Diffs in the golden must be reviewed by a human.
- **Parser fixtures:** one tiny project per construct, with the expected blocks and edges written by hand.
- **Check tests:** synthetic plans where a claimed edge is missing, an extra edge appears, or a planned block isn't written.
- **UI:**
  - Playwright screenshot tests of the map at three zoom levels and three modes
  - a test that fails on any console error
  - a mobile-width test with no horizontal scroll
- **Perf:** parse time and incremental update time on the chosen real repo, tracked in CI.

---

## 21. Decisions on the open questions

Decided 2026-10-13. Each one was an open question; the answer and what the build does now are below.

1. **Plan shape: full drafts only.** Claims (`plan claim`) cover "I intend this call". Intent-only sketches are a second parsing path and wait until someone asks for very early sketching.
2. **Baseline: both, as a toggle.** Git HEAD by default, `--baseline disk` for "files as they were at start". Falls back to disk with no git repo. Built.
3. **Default scope on open: whole repo for small projects, focused view above a size threshold.** One click to switch (focus on changes plus one hop, or the whole project). Snapshots are already plan files plus one hop by default. The live map's toggle is not built yet.
4. **Inspector: parser facts only in v1.** "Used by" and "Uses" come from the parser's edges. No "Summarize usage" button, since Claude does that in chat from `print --json`. Capped repo-wide references through the language service come later only if "Used by" misses too much.
5. **Per-file story view: deferred.** It would be a layout mode on top of the current map, not needed for v1.
6. **License: MIT.**
7. **Telemetry: none.** The server binds to 127.0.0.1 and sends nothing anywhere.

## 22. Prototype bundle (`blueprint-prototype.zip`)

Everything here is throwaway reference code written during design. It works, but it's not production structure. All names still say "storyline".

| Path | What it is |
|---|---|
| `parser/package.json` | Pins `typescript@5.9` (run `npm i` here first; the build scripts resolve TS from `parser/node_modules`) |
| `parse2.js`, `build2.js`, `template2.html`, `storyline2.html` | Earlier **per-file** prototype ("Storyline Canvas"): one file as draggable real-code blocks, class as container, arrows from the calling line, one-hop external blocks with origin path, inspector with Used by / Uses |
| `demo/src/` | Tiny project used by the per-file prototype (`orders.ts`, `utils/money.ts`, `audit/log.ts`) |
| `flow.html` | 7-step walkthrough of the per-file flow (open, cut into blocks, storyline, click, who uses it, summarize, Claude opens it) |
| `feat/before/src`, `feat/after/src` | **Refund demo**: a type-checked mini project before and after a "refund support" feature (7 files after) |
| `feat/build3.js` | Parses both trees, computes blocks, diffs, edges and statuses, writes `feat/data.json`. `cd feat && node build3.js` |
| `feat/data.json` | The Graph for the refund demo (section 7 shape) |
| `feat/e.html`, `feat/pm.css`, `feat/pm.js`, `feat/out_e.html` | **The Plan Map** Joe approved. `e.html` is the template (`__DATA__` placeholder), `pm.css` and `pm.js` are the extracted reusable parts (with `pmOnSelect` and `pmOnMode` hooks), `out_e.html` is built and self-contained |
| `m2/a.html` to `d.html`, `m2/build.py`, `m2/out_*.html` | Surface mocks built on the Plan Map data: **a** Claude Code session text, **b** terminal TUI, **c** VS Code with the map panel and editor sync, **d** browser tab via `npx`. `python3 build.py` inlines CSS, JS and data |
| `mocks/` | Older surface mocks for the per-file version (superseded by `m2/`) |

**Staged, not computed, in the prototype:**
- the plan-only arrow `refundHandler -> recordAudit` (the "1 of 10 not in the code")
- all chat and command text in the mocks
- the hand-written `LAYOUT`
- the added `export` keywords in the demo's `orders.ts` (so other files can import from it)

---

## 23. Lessons learned while prototyping

- Pin TypeScript 5.x. TS 7 (the native port) broke the JS compiler API usage.
- `lib.dom.d.ts` is needed for `console` unless the tsconfig provides types.
- Don't turn type references into call edges (an early bug made class type annotations look like calls).
- Terminal rendering: use only glyphs the monospace font actually has (ASCII and box-drawing). Lay out cells at a fixed 1ch width and scale the font to the container. Unicode arrows and checkmarks fell back to other fonts and broke the alignment.
- Namespace UI CSS classes (see 11.7).
- Regex replacement over code containing U+2028 and U+2029 broke a build script. Escape them when inlining JSON into `<script>`, and also escape `</` as `<\/`.
- Plan arrows must look visibly different from parsed arrows. Users trust solid lines.

---

## 24. Style notes for the repo

- Joe's preferences: concise, punchy, casual docs. Technically precise, no overclaiming. **No em dashes anywhere** (docs, comments, UI copy).
- Code comments: casual lowercase explanations, e.g. `// skip decl names so params don't count as calls`.
- The README should state the limits (section 8.5) up front. Honesty about what the parser can't see is part of the product.
