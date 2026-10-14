# Roadmap: the window, the terminal and VS Code

What we are polishing and building around the parts people see and touch. The engine work lives in [ROADMAP-engine.md](ROADMAP-engine.md).

Status key: done, doing, next, later, parked (the user asked to leave it for now).

## 1. Visuals inside Claude Code

The window should look like part of the Claude app, in dark and light, and stay out of the way of the chat.

| Item | Status | Notes |
| --- | --- | --- |
| Colors sampled from the app (backgrounds, text, borders) | done | re-check light mode against a fresh screenshot |
| Block fills neutral, kind shown by border only (blue functions, coral classes, grey types) | done | |
| Project zoom block names centred and readable | done | |
| File arrows route around cards that sit between two files | done | PR #20 |
| Block arrows at code zoom: overlap and routing for existing calls | next | send a screenshot of any that look wrong, then fix the routing |
| Fit camera leaves no empty band above short maps | done | not yet re-checked in the app pane |
| Fonts: Anthropic Sans and Mono are not ours to ship, so we use Instrument Sans and IBM Plex Mono | done | revisit only if the fonts become available to third parties |
| Plan blocks show up on the map while Claude is still planning, before accept | parked | |
| Window opens by itself when a prompt is pasted | parked | skill triggers are broader now, still needs a real session test |
| Skill triggers on "show me a blueprint of ..." | doing | needs `blueprint skill install` once, verify in a fresh session |

## 2. Terminal

The CLI should be useful with no Claude session at all.

| Item | Status | Notes |
| --- | --- | --- |
| `blueprint watch` opens one window per project and reuses a running watcher | done | |
| Watcher stops itself after 30 idle minutes (`BLUEPRINT_IDLE_MINUTES`) | done | |
| Open as a small chromeless app window (Chrome or Edge `--app`) instead of a tab | next | falls back to a normal tab, same window per project |
| `blueprint stop` to end the watcher for a project | next | so stale processes do not pile up on ports 4711 and up |
| Check `plan show`, `check`, `status` read well as plain text | next | no map needed to review a plan |
| Terminal only mode (a TUI map) | later | only if people want it over SSH, the browser map stays the main view |
| Walk through the whole flow from a plain terminal with no Claude | next | `docs/TESTING.md` gets a section for it |

## 3. VS Code extension

Not started. The idea is the same window, living where people already read code.

Plan:

1. A panel that hosts the existing UI against the same local server, so there is one renderer to maintain.
2. Start and stop the watcher for the open workspace folder.
3. Reveal in map: put the cursor in a function and focus its block.
4. Click a block to jump to the line (already works as a `vscode://file/` link from the browser).
5. A status bar item with the plan state and counts from `check`.
6. Later: CodeLens above functions with caller counts.

Open questions:

- Webview with the bundled UI, or the Simple Browser pointing at the local server? The webview is nicer, the Simple Browser is faster to build.
- How the extension finds or ships the CLI. Not published to npm or the marketplace yet, that decision stays open in `docs/CONTEXT.md` section 21.
- Read only stays the rule. Anything that changes a plan happens through the CLI from chat or a terminal.

## Order

1. Block arrow polish and verifying the skill in a fresh session.
2. Chromeless window and `blueprint stop`.
3. VS Code extension: panel plus watcher control, then reveal in map.
