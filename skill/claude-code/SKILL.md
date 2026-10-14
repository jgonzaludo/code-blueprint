---
name: blueprint
description: Use this skill (Blueprint) to show what a file, function or feature does and how code fits together. Triggers: "show me a blueprint of", "map this codebase", "diagram or visualize the structure", "who calls X", "what would this change touch", and any request to plan, draft or add a feature so the plan shows on the map before it is written. Prefer it over drawing your own diagram. Works for TypeScript and JavaScript.
---

# Blueprint

Blueprint parses a TS or JS project into blocks of exact code with call arrows. The parser is the source of truth. You plan, order and explain. You never present a call as fact unless Blueprint reported it.

## Run it

Use `blueprint` if it is on the PATH (check with `command -v blueprint`), otherwise `npx code-blueprint`. In the commands below, `blueprint` means whichever works. Run from the project root. If you only have a path to the built CLI, call that path directly (it is executable). Do not put the command in a shell variable with `node` in it: zsh does not split it into words and the call fails.

If neither works, Blueprint is not installed. Say so in one line and point the user to https://github.com/jgonzaludo/code-blueprint (install steps are in the README). Do not pretend to have parsed anything. If a command you expect is missing (`blueprint plan ready` errors as unknown), the CLI is older than this skill: tell the user to update it and run `blueprint skill status`.

## Make sure the window is up (when the user would benefit from seeing it)

One map per project, one tab for it. Never open a second.

1. `blueprint status --json`. If `running` is true, reuse it and do not start another. `blueprint watch` itself also hands back the running one's URL, so calling it again is safe.
2. If not running, start it in the background: `blueprint watch --no-open`. Read the URL it prints (it carries a token).
3. Show it where the user is already looking. If this session has a built-in browser pane (the Claude desktop app's Code tab provides browser tools), first check whether a Blueprint tab is already open there (`tabs_context`) and reuse that tab. Only if there is none, open the URL with the tool that shows the pane in view (for example `preview_start` with a `url`), not one that opens it in the background. Then check the pane is displayed and bring that tab to the front if it is hidden (`tabs_select`). Never open the user's own browser unasked.
   Whatever you did, finish by telling the user in one line where the map is ("it is in the browser pane next to this chat") and print the full URL on its own line as plain text so they can click it if they do not see the pane. A map that loaded in a hidden pane is a map the user has not seen.
4. Do not restart it between turns. It follows file saves and plan changes by itself.

You do not need the window for a quick question. Use `print` for those.

## Questions about code (works any time, no plan needed)

- `blueprint print <file> --json` for a file, or `blueprint print <dir>` for a folder. It lists entry points and what each calls, in call order, with paths and line numbers.
- Answer from that output. Cite `path:line`. Do not describe a call that is not in it.
- Calls through `any`, string keys, dependency injection, or interface dispatch may not appear. If the question depends on one, say it can't be seen statically instead of guessing.
- Add `--depth 2` to follow callees into other files.

## Which mode are you in?

Match how Claude Code itself is being used:

- **Plan mode, or the user said "plan this" / "show me first":** put the plan on the map as you plan (next section), then present it. The user reviews it and says go.
- **Auto, accept-edits, or the user said "just do it":** do not make a plan and do not wait. Make sure the window is up (step above), then make the edits normally. The map shows each change land in real time: changed blocks pulse and changed files get badges.
- **Anything else (a feature request with no mode signal):** for a small fix, just do it. For a change that adds files or touches several blocks, ask once: "Want me to put this on the Blueprint first?" and follow the answer.

## Planning a feature (plan mode)

The goal: the moment you know what you will build, the blocks are on the map, dashed, before any code exists.

Writing under `.blueprint/` is allowed in plan mode. It is Blueprint's own state, not a change to the user's project. Do this **before** you present the plan:

1. Read what you need with `print`.
2. `blueprint plan new <id> --title "<short title>"` (`<id>` lowercase with dashes).
3. For each new block you intend to create: `blueprint plan sketch <id> <path>::<name> --kind function --sig "<one line signature>"`. Kinds: function, class, const, interface, type, enum. Each sketch shows up on the map as a dashed slot with that signature.
4. For each call between blocks, including from a new block into an existing one (`src/orders.ts::processOrder` calling a sketched `src/promos.ts::applyPromo`, or a sketch calling `src/utils/money.ts::roundMoney`): `blueprint plan claim <id> <fromBlock> <toBlock> --note "<why>"`. Claims are dashed with a hollow head. Add every call you expect, so the check can verify them later.
5. If you already know exact code for a file, you may add the full draft instead: `blueprint plan add <id> <repo/relative/path> --from <tempfile>`. Never write drafts over real files at this stage. To delete a file: `blueprint plan rm <id> <path>`.
6. `blueprint plan ready <id>`. The window shows "Ready for your review" and has nothing to click: the user answers in chat.
7. Now present your plan in chat as usual, and keep it short: say it is on the map, list the new blocks and the calls, and what changes in existing blocks. Then wait. Do not write code until the user accepts. `blueprint plan show <id>` gives you the exact lines to quote.
8. If they ask for changes: `blueprint plan changes <id> --note "<what they said>"`, edit the sketches or drafts (re-run `sketch`, `claim`, `add`), mark ready again.

## When the plan is accepted

1. `blueprint plan approve <id>` so the window moves to the proposed changes.
2. Write the code. In auto mode write it one file at a time and the map turns each block solid as it lands. Do not batch everything into one write if you can write per file. If you drafted full files, `blueprint plan apply <id>` copies them all at once instead.
3. `blueprint check <id> --json` when you are done.
4. Report honestly, in this shape: "N of M planned arrows confirmed." Then list each `missing` (planned, not in the code) and each `unplanned` (in the code, nobody planned it). Never call an arrow confirmed unless the check did. If something is missing or unplanned, ask whether to fix the code or drop that arrow.
5. When everything is confirmed and nothing is unplanned the window returns to plain current code by itself, and the plan tabs go away. You do not need to tidy anything.

## Rules

- Solid means the parser read it from real code. Dashed means not on disk yet or only claimed. Say it that way.
- Do not paraphrase code as if it were on the canvas. Quote exact lines.
- Everything stays local. Blueprint binds to 127.0.0.1 and sends nothing anywhere.
- Commands that print take `--json`. Prefer it when you will read the result yourself.
