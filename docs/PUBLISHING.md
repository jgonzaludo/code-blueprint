# Publishing

Nothing is published yet. This is the checklist for when you decide to.

## What there is to publish

| Thing | Where it lives | How people get it |
|---|---|---|
| The `blueprint` CLI (with the map page and both skills bundled) | npm package `code-blueprint` | `npx code-blueprint`, or `npm i -g code-blueprint` for a `blueprint` command |
| The Claude Code skill, as a plugin | `plugin/` plus `.claude-plugin/marketplace.json` in this repo | `/plugin marketplace add jgonzaludo/code-blueprint`, then `/plugin install blueprint@code-blueprint` |
| The Claude Code skill, by hand | `skill/claude-code/SKILL.md` | `blueprint skill install` |
| The Claude app skill | `skill/claude-app/SKILL.md` | `blueprint skill print --app`, then upload it in the app |

## How updates reach people

- **npm:** a new version of `code-blueprint`. People on `npx` get it on the next run, global installs need `npm i -g code-blueprint@latest`.
- **Plugin:** `plugin.json` has no `version`, so the git commit is the version and every commit on the default branch reaches installed copies (users run `/reload-plugins`, or turn on auto-update for the marketplace). Pin a `version` there if you would rather ship deliberately.
- **Hand-installed skill:** it is a copy. `blueprint skill status` says whether an installed copy is older than the CLI, `blueprint skill install` refreshes it.
- **Skill and CLI must match.** The tests check every command the skill mentions exists in the CLI, and that the plugin copy equals `skill/claude-code/SKILL.md`. After editing the skill run `pnpm sync:plugin`.

## Before the first npm publish

1. Recheck the name: `npm view code-blueprint` should still 404 (it did on 2026-10-13). The backup is a scoped `@jgonzaludo/blueprint`.
2. Skim for trademark conflicts (Palantir's Blueprint UI toolkit and Unreal Blueprints dominate search results, see CONTEXT section 17).
3. In `packages/cli/package.json` remove `"private": true`. It is there on purpose so nothing publishes by accident.
4. `pnpm install && pnpm -r build && pnpm test` on a clean checkout.
5. `npm pack` in `packages/cli` and run it once from a temp folder: `npx ./code-blueprint-0.1.0.tgz --help`.
6. Bump the version, tag it, then `npm publish` from `packages/cli` (use `--access public` only if you switch to a scoped name).

None of this is done for you. Publishing is yours to do.
