---
name: blueprint-app
description: Show code structure and feature plans as a map of real code, as a shareable artifact. Use in the Claude app when the user asks what a codebase, file or feature does, who calls what, or to plan a feature before it is built, and the code is available here (attached files, a cloned repo, or a linked computer). Works for TypeScript and JavaScript.
---

# Blueprint (Claude app)

Blueprint parses a TS or JS project into blocks of exact code with call arrows. The parser is the source of truth. You plan, order and explain. A call is only a fact if Blueprint reported it. Everything here is a snapshot: it does not update by itself.

## First: do you have the code?

The map is built from real files, so you need them.

- Files attached, a cloned repo, or a linked computer: go on.
- Linked computer (desktop app can run commands on the user's machine): prefer the live version. Run `blueprint watch --no-open` there, open the URL in the built-in browser pane if you have one (otherwise give the user the localhost URL), then use the Claude Code steps (`print`, `plan`, `check`). The map then updates on every save. Use snapshots only if that is not possible.
- No code: say so in one line and ask for the files or a GitHub repo. Do not invent a map, and do not describe structure you have not parsed.

## Run it

Use `blueprint` if it is on the PATH, otherwise `npx code-blueprint`. If neither can run here (no network or no Node), say that plainly instead of guessing, and offer the plan as text only. Install steps are in the README at https://github.com/jgonzaludo/code-blueprint.

## A question about code

1. `blueprint print <file> --json` (or a directory). Answer from the output and cite `path:line`.
2. If a picture helps, `blueprint snapshot --all --out blueprint.html` and publish `blueprint.html` as an artifact titled "Blueprint: <project>". Tell the user it is a snapshot.
3. Calls through `any`, string keys, dependency injection or interface dispatch may not appear. Say so when a question depends on one.

## Planning a feature

1. Draft the full contents of each new or changed file. Keep them as temp files, never over real files yet.
2. `blueprint plan new <id> --title "<short title>"`, then `blueprint plan add <id> <path> --from <tempfile>` for each file. Use `blueprint plan claim <id> <fromBlock> <toBlock> --note "<why>"` only for a call you intend but did not write into any draft.
3. `blueprint snapshot --plan <id> --out blueprint.html`. It contains the plan's files plus one hop, so it stays small. Publish it as an artifact titled "Blueprint: <plan title>" and remember its URL.
4. Tell the user what is on it: new files in a band on top, changed files badged, zoom in for exact lines, dashed arrows are proposed and a hollow arrowhead is a claim. Add a few lines from `blueprint plan show <id>`.
5. Wait for approval. Do not apply anything until the user says go.

## After approval

1. Apply the change (`blueprint plan apply <id>` or edit the files).
2. `blueprint check <id> --json`.
3. `blueprint snapshot --plan <id> --out blueprint.html` again and republish to the **same** artifact URL, so the user sees the check on the map they already have open.
4. Report honestly: "N of M planned arrows confirmed", then each one not in the code and each unplanned call. Never call an arrow confirmed unless the check did. Ask whether to fix the code or drop that arrow.

## Rules

- Solid is read from real code. Dashed is not on disk yet or only claimed. Say it that way.
- Quote exact lines, never paraphrase code as if it were on the map.
- Artifacts must stay under 16 MB. If the snapshot is large, snapshot the plan only (the default) rather than `--all`.
- Nothing is sent anywhere by Blueprint itself.
