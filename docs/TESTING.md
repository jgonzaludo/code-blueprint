# Testing Blueprint by hand

Automated tests cover the parser, the CLI, the server and the page in a real browser. What they can't tell you is whether it is useful and pleasant on your own code, and whether a real Claude session follows the skill. This is the checklist for that.

## 0. Setup (2 minutes)

```bash
git clone https://github.com/jgonzaludo/code-blueprint.git
cd code-blueprint
pnpm install
pnpm -r build
```

Needs Node 20 or later and pnpm (`corepack enable`). Below, `blueprint` means `node /path/to/code-blueprint/packages/cli/dist/cli.js`. Put an alias in your shell if you like:

```bash
alias blueprint="node $(pwd)/packages/cli/dist/cli.js"
```

## 1. See the whole loop in one command

```bash
pnpm demo
```

It makes a throwaway project, drafts the refund feature as a plan, marks it ready, and opens the map. Then:

- Plan view: new files in a dashed band on top, `orders.ts` badged, dashed arrows. Zoom into `orders.ts` and find the one-line `OrderStatus` change and the new `restock` method.
- The card says "Ready for your review". The window has no buttons: you answer in the terminal with `plan approve` (or `plan changes --note "..."`), and the card follows.
- In a second terminal, run the two commands the demo printed (`plan apply`, then `check`).
- Click **After applying**. Expect **9 of 10 proposed arrows confirmed**, with `refundHandler to recordAudit` named as not in the code.

Ctrl-C stops it and deletes the project.

## 2. Look at your own code

From the root of a TypeScript or JavaScript project (this is read only, it never edits your files; it makes a self-ignoring `.blueprint/` folder):

```bash
blueprint                      # opens the live map
blueprint print src/some/file.ts
blueprint print src --depth 2
```

Things worth checking:

- Does the map match how you think about the project? Are any arrows missing that you know exist? (Calls through `any`, string keys, DI containers and interface dispatch are known gaps.)
- Zoom from the project map down to exact lines. Are the lines exactly your code?
- Click a block. Is "Used by" and "Uses" right?
- On a big project (over 60 files) with uncommitted changes it opens focused on the change plus one hop. Does the switch to "Whole project" feel right?
- Edit and save a file. Does the changed block update and pulse within a second, and does its file get a badge?
- Does it feel fast enough on your repo? Note the file count and the "parsed N files in X ms" line in the terminal.
- Use `--include-tests` if you want test files on the map (they are skipped by default).

## 3. Use it from Claude Code

```bash
blueprint skill install --project     # or without --project for all your projects
blueprint skill status                # says up to date or outdated
```

Start a new Claude Code session in that project and try, one at a time:

1. "What does `src/<some file>` do?" Expect Claude to run `blueprint print` and cite `path:line`, without a plan.
2. "Who calls `<some function>`?"
3. In **plan mode**: "Add `<a small feature touching 2 or 3 files>`". Expect it to start the map, add draft files, mark the plan ready, summarize, and stop. It should not edit your files.
4. Say "go". Expect it to run `plan approve` (the card says Approved), apply, run `check`, and report "N of M confirmed", listing anything missing or unplanned.
5. In **auto / accept edits** mode: "Add `<something small>`". Expect no plan: it just edits, and the map changes live.

What to note: did it ask before planning something big? Did it say "confirmed" about anything the check didn't confirm? Did it invent a call that `print` never showed?

Also, to install it as a plugin instead of copying the file:

```
/plugin marketplace add jgonzaludo/code-blueprint
/plugin install blueprint@code-blueprint
```

## 4. Share a map

```bash
blueprint snapshot --out map.html          # newest plan plus one hop
blueprint snapshot --all --out map.html
```

Open `map.html` straight from disk, with the network off. It should look the same, say "snapshot" instead of "watching", and have no buttons that change anything (the window is read only everywhere).

## 5. Try to break it

- A project with type errors (it should still parse and say how many).
- A file over 5,000 lines, or minified code (it is skipped on purpose).
- A project with no git (it falls back to disk as the baseline).
- Two plans at once (a picker appears), then archive one.
- Delete a file that a plan modifies.
- Open the page URL without the token (expect a 401), or edit the port in the URL.

## What to send back

For anything that felt off: what you did, what you expected, what happened, and a screenshot or the terminal output. Parser misses (an arrow that should exist) are the most useful: the file, the line, and the call.
