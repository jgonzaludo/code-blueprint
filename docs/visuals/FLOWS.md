# Blueprint user flows (text versions)

These are the same flows as the PNGs in `flows/`, written as text and mermaid so they can be read without the images. `docs/CONTEXT.md` has the full detail. The section numbers below point into it.

## F1. Draft a feature with Claude (main flow, CONTEXT 4.2 and 9)

```mermaid
sequenceDiagram
  actor U as You
  participant C as Claude (Blueprint skill)
  participant W as Watcher (local)
  participant M as Map window
  U->>C: "add refund support..."
  C->>W: blueprint status, else blueprint watch (auto-opens browser)
  W->>M: current map (parsed vs git HEAD)
  C->>W: write draft to .blueprint/plans/<id>/ (+ claims)
  W->>W: parse(disk + draft overlay), diff
  W->>M: plan view: new files band on top, badges, exact +/- lines, dashed arrows
  C->>U: text summary (blueprint plan show)
  U->>C: "go" (or push back)
  C->>C: edit real files (or blueprint plan apply)
  W->>W: re-parse disk, check vs draft + claims
  W->>M: applied view: confirmed solid, missing flagged
  C->>U: "9 of 10 confirmed. Not in the code: refundHandler -> recordAudit"
  U->>C: fix the code or drop the arrow
```

Arrow states: same (solid neutral), proposed (dashed green), confirmed (solid green), missing / "not in the code" (red dashed), unplanned (amber), claim (dashed, hollow arrowhead).

## F2. Live while editing (CONTEXT 4.3 and 10.2)

```mermaid
flowchart LR
  A[Save a file] --> B[fs event<br/>chokidar, gitignore]
  B --> C[Debounce 100-200 ms]
  C --> D[Incremental parse<br/>long-lived TS language service]
  D --> E[Diff vs baseline<br/>git HEAD]
  E --> F[Push over SSE<br/>/api/events]
  F --> G[Map updates in place<br/>layout never jumps]
```

## F3. Which surface where (CONTEXT 5)

```mermaid
flowchart LR
  Q1[Claude Code<br/>terminal, desktop, VS Code terminal] --> L1[LIVE: skill starts blueprint watch] --> S1[Browser tab auto-opens<br/>TUI optional]
  Q2[Claude app + linked computer] --> L2[LIVE: watcher via Claude's shell on your machine] --> S2[You open localhost tab]
  Q3[Claude app, cloud only] --> L3[SNAPSHOT: core in sandbox<br/>needs the code there] --> S3[blueprint snapshot -> artifact<br/>republished per turn]
  Q4[Plain VS Code / Cursor / Windsurf] --> L4[LIVE: browser tab beside editor<br/>click -> code -g file:line] --> S4[LATER: extension, polish only]
```

## F4. Plan protocol and check (CONTEXT 9)

```mermaid
flowchart LR
  A[plan new<br/>plan.json: id, title, files, delete, claims] --> B[plan add<br/>full draft file contents]
  B --> C[parse disk + draft overlay<br/>diff disk vs draft]
  C --> D[plan view<br/>dashed = proposed, hollow head = claim]
  D --> E[apply]
  E --> F{check: applied vs draft + claims}
  F -->|in both| G[confirmed]
  F -->|planned, not in code| H[missing: not in the code]
  F -->|in code, not planned| I[unplanned]
```

## F5. Semantic zoom (CONTEXT 11.1)

```mermaid
flowchart LR
  A["Project map (scale < 0.5)<br/>file cards, badges, file arrows,<br/>new files band on top"] <--> B["File (0.5 to 0.95)<br/>blocks + block arrows"]
  B <--> C["Code, line for line (>= 0.95)<br/>exact lines, old/new numbers, +/-, new slots"]
```

## F6. Ask about code (CONTEXT 4.1)

```mermaid
flowchart LR
  A["You: what does src/orders.ts do?"] --> B[Claude: blueprint print src/orders.ts --json]
  B --> C[Text tree in chat<br/>entry fn, call order, external calls with paths + lines]
  B --> D[If watcher running: map jumps to that file]
```
