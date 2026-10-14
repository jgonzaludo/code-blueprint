---
name: blueprint
description: Show code structure as a live map of real code and exact call trees. Use when the user asks what a file, function or feature does, who calls what, or what a change would touch, and also when they ask to plan, draft or add a feature (show the plan on the map before writing it, then check what got built). Works for TypeScript and JavaScript projects.
---

# Blueprint

Blueprint parses a TS or JS project into blocks of exact code with call arrows. The parser is the source of truth. You plan, order and explain. You never present a call as fact unless Blueprint reported it.

## Run it

Use `blueprint` if it is on the PATH (check with `command -v blueprint`), otherwise `npx code-blueprint`. In the commands below, `blueprint` means whichever works. Run from the project root.

If neither works, Blueprint is not installed. Say so in one line and point the user to https://github.com/jgonzaludo/code-blueprint (install steps are in the README). Do not pretend to have parsed anything. If a command you expect is missing (`blueprint plan ready` errors as unknown), the CLI is older than this skill: tell the user to update it and run `blueprint skill status`.

## Make sure the window is up (when the user would benefit from seeing it)

1. `blueprint status --json`. If `running` is true, reuse it and tell the user the URL once.
2. If not running, start it in the background: `blueprint watch --no-open`. Read the URL it prints (it carries a token) and give it to the user in one line. If the user is at a machine with a display and wants it opened, run `blueprint watch` without `--no-open`.
3. Do not restart it between turns. It follows file saves by itself.

You do not need the window for a quick question. Use `print` for those.

## Questions about code (works any time, no plan needed)

- `blueprint print <file> --json` for a file, or `blueprint print <dir>` for a folder. It lists entry points and what each calls, in call order, with paths and line numbers.
- Answer from that output. Cite `path:line`. Do not describe a call that is not in it.
- Calls through `any`, string keys, dependency injection, or interface dispatch may not appear. If the question depends on one, say it can't be seen statically instead of guessing.
- Add `--depth 2` to follow callees into other files.

## Which mode are you in?

Match how Claude Code itself is being used:

- **Plan mode, or the user said "plan this" / "show me first":** use a plan (next section). The user reviews it on the map and says go.
- **Auto, accept-edits, or the user said "just do it":** do not make a plan and do not wait. Make sure the window is up (step above), then make the edits normally. The map shows each change land in real time: changed blocks pulse and the Changes list fills in against HEAD. Nothing else is needed. You can use `blueprint print <file>` afterwards to describe what the code now does.
- **Anything else (a feature request with no mode signal):** for a small fix, just do it. For a change that adds files or touches several blocks, ask once: "Want me to put this on the Blueprint first?" and follow the answer.

## Planning a feature (plan mode)

1. Read what you need with `print`, then draft the full contents of each new or changed file. Write them to temp files outside the project (never over real files at this stage).
2. `blueprint plan new <id> --title "<short title>"` where `<id>` is lowercase with dashes.
3. For each file: `blueprint plan add <id> <repo/relative/path> --from <tempfile>` (or pipe the contents on stdin). To delete a file: `blueprint plan rm <id> <path>`. The map shows files as you add them, so add them together once the draft is complete.
4. Only for a call you intend but did not write into any draft (a stub, a follow up): `blueprint plan claim <id> <fromBlock> <toBlock> --note "<why>"`. Blocks look like `src/a.ts::name`. Claims are drawn dashed with a hollow head. Do not use claims for things the drafts already contain.
5. `blueprint plan ready <id>`. This marks the draft finished and puts Approve and Ask for changes buttons in the plan view.
6. `blueprint plan show <id>` and summarize it in chat in a few lines: new files, changed blocks with exact lines, what the new code uses. Tell the user the plan is on the map (new files in a band on top, zoom in for exact lines) and wait.
7. Do not edit real files until the user says go. If they say go in chat, that is enough. If they use the buttons, `blueprint plan status <id> --json` tells you: `approved`, or `changes` with a `note`. On `changes`, revise the drafts (`plan add` again) and mark it ready again.

If you are in Claude Code plan mode, do steps 1 to 6 through the `blueprint plan` commands (they write under `.blueprint/`), so the user reviews the map and your plan text together.

## After approval

1. Make the edits, or run `blueprint plan apply <id>`. If the plan was marked ready, apply waits for the user's go. Pass `--yes` only when the user said go in chat.
2. `blueprint check <id> --json`.
3. Report honestly, in this shape: "N of M planned arrows confirmed." Then list each `missing` (planned, not in the code) and each `unplanned` (in the code, nobody planned it). Never call an arrow confirmed unless the check did.
4. Ask whether to fix the code or drop that arrow from the plan. Do not silently fix or silently ignore. Once it is settled, `blueprint plan archive <id>` tidies it away.

## Rules

- Solid means the parser read it from real code. Dashed means not on disk yet or only claimed. Say it that way.
- Do not paraphrase code as if it were on the canvas. Quote exact lines.
- Everything stays local. Blueprint binds to 127.0.0.1 and sends nothing anywhere.
- Commands that print take `--json`. Prefer it when you will read the result yourself.
