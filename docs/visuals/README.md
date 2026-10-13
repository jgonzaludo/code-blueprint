# Blueprint visual pack

Screenshots of every prototype state, plus user flow diagrams, for explaining what Blueprint should look like and do. Read it alongside `docs/CONTEXT.md`, which is the spec.

**Read these first:** `flows/F1-draft-a-feature-swimlane.png` (the main loop), `screens/02-planmap-claude-plan.png` (the plan view), `screens/03-planmap-zoom-modified-block-inventory.png` (exact lines on zoom), and `screens/06-planmap-after-applying-check.png` (the check).

> **In this repo:** only `FLOWS.md`, all of `flows/`, and the four "read these first" screens (01, 02, 03, 06) are committed, to keep git history small. The full screenshot set (13 MB, 27 images) lives in the original `blueprint-visuals.zip`. Rows below that list a screen not in `screens/` refer to that zip.

## How to treat these images
- These are **design references, not pixel specs.** Match the behavior and information shown. Visual polish is open.
- Every block, line number, diff line and arrow comes from a **real type-checked mini project** (the refund demo in `prototype/feat/`). The data is exact.
- **Staged, not computed:**
  - the plan-only arrow `refundHandler -> recordAudit`, which produces the "1 of 10 not in the code" result
  - all chat and command text
  - the VS Code window chrome
  - the hand-placed layout
- The prototype pages still say **"Storyline"**, which was the old name. The product is **Blueprint**.
- Screens were rendered at 2x with the real fonts (Schibsted Grotesk for the UI, JetBrains Mono for code).

## flows/ (user flows, also in FLOWS.md as mermaid)
| File | Shows | CONTEXT section |
|---|---|---|
| F1-draft-a-feature-swimlane.png | The main loop across 4 lanes: you, Claude, watcher, map window. Draft, plan view, approve, apply, check, report. Includes the arrow legend. | 4.2, 9 |
| F2-live-edit-loop.png | Save, fs event, debounce, incremental parse, diff vs HEAD, push over SSE | 4.3, 10.2 |
| F3-which-surface-where.png | Claude Code, Claude app linked, Claude app cloud only, and plain VS Code, mapped to live, snapshot or later | 5 |
| F4-architecture.png | Files to watcher to core to server to UI, plus the skills and later items | 6 |
| F5-plan-protocol-and-check.png | plan new, plan add, overlay parse, plan view, apply, check, and the 3 check outcomes | 9 |
| F6-semantic-zoom-levels.png | The three zoom levels and their thresholds | 11.1 |
| flows.html | Source for the diagrams | |

## screens/ (prototype states)
| File | Shows | CONTEXT section |
|---|---|---|
| 01-planmap-current-code.png | Project map of the repo as it is: 5 files, file arrows | 11 |
| 02-planmap-claude-plan.png | **The plan view.** New files in a dashed band on top, orders.ts badged "~2 modified +1 new slot", money.ts and log.ts badged "used by new code", dashed arrows, plan side panel | 11.2, 11.5 |
| 03-planmap-zoom-modified-block-inventory.png | Zoomed into class `Inventory`: exact lines, the new `restock` method as added lines (a "slot"), inspector with Used by / Uses | 11.3 |
| 04-planmap-zoom-one-line-change-orderstatus.png | Smallest possible change: one line, minus and plus, with old and new line numbers | 11.3 |
| 05-planmap-zoom-new-file-refundorder.png | A new block in a new file, every line marked added, arrows out to calculateRefundTotal, roundMoney, restockOrderItems and recordAudit | 11.3, 11.4 |
| 06-planmap-after-applying-check.png | After applying: arrows solid, side panel says "9 of 10 proposed arrows confirmed" and names the missing one | 9, 11.5 |
| 07-planmap-plan-dark-theme.png | Same plan view in dark theme | 11.6 |
| 10-claude-code-1-plan-as-text.png | Chat surface: Claude prints the plan as a text tree (new files, changed blocks with exact diff lines) plus a link to the map | 12.1, 13 |
| 11-claude-code-2-after-edit-check.png | Chat surface after the edit: Write and Update calls, then the check list with [ok] / [x] | 13 |
| 20-terminal-tui-map-plan.png | TUI map: NEW FILES band, EXISTING boxes, dashed borders for proposed, info pane with calls / called by | 14 |
| 21-terminal-tui-file-zoom-exact-lines.png | TUI zoomed into a new file: exact lines, `--> callee` markers | 14 |
| 22-terminal-tui-modified-file-diff.png, 22b-...-scrolled.png | TUI zoomed into orders.ts: the one-line change, and the `restock` lines 47 to 52 highlighted | 14 |
| 23-terminal-tui-applied-check.png | TUI check banner | 14 |
| 30-vscode-plan-panel-and-proposed-file.png | VS Code: proposed file in the editor with green lines and CodeLens ("2 uses, 1 caller, Show on map"), map panel beside it, explorer badges A? / M | 15 (later) |
| 31-vscode-click-sync-map-to-editor.png | Clicking a block on the map jumps the editor to its exact lines | 15 |
| 32-vscode-applied-check-flags-missing-call.png | After applying: the editor banner flags the planned call that isn't in the code | 15 |
| 40-browser-tab-npx-plan.png | **The v1 main surface**: `npx code-blueprint` output, then the browser tab with the map, "watching" indicator | 5, 10 |
| 41-browser-tab-after-file-change.png | The watcher detects the change, the parser re-checks, and the map flips to applied | 10.2 |
| 50-earlier-per-file-canvas.png | The original per-file concept: one file as real-code blocks, class as container, one-hop external blocks with origin path | 1, 21 (Q5) |
| 60-...flow-step-1.png to 66-...flow-step-7.png | Earlier 7-step walkthrough of the per-file idea: open, cut into blocks, storyline, click, who uses it, summarize, Claude opens it | 1 |

## What to build first
The browser tab (40, 41) showing the Plan Map (01 to 07), driven by the real watcher and parser. Then the Claude Code skill and its text output (10, 11). The TUI (20 to 23) and VS Code (30 to 32) come later. See CONTEXT section 19.
