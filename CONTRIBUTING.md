# Contributing

## Commits and PR titles: Conventional Commits

We use [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/), the same convention Angular, Vue, Electron and most large open source projects use. It keeps history scannable and lets changelogs and version bumps be generated later.

```
<type>(<scope>): <short summary in the imperative, lowercase, no period>

<optional body: what and why, wrapped at about 72 columns>
```

Types:

| type | use for |
|---|---|
| `feat` | a new capability users can see |
| `fix` | a bug fix |
| `docs` | docs only |
| `test` | adding or fixing tests only |
| `refactor` | code change that neither fixes a bug nor adds a feature |
| `perf` | a performance improvement |
| `build` | build system or dependencies |
| `ci` | CI config |
| `chore` | everything else (tooling, housekeeping) |

Scopes are the package or area: `core`, `cli`, `ui`, `skill`, `docs`. Leave it off when a change spans several.

Breaking changes: add `!` after the type or scope (`feat(core)!: ...`) and a `BREAKING CHANGE:` line in the body.

## Names, not numbers

Name work by what it is (`plan-check`, `live-map`, `claude-skill`), never by a milestone number. See section 19 of [docs/CONTEXT.md](docs/CONTEXT.md) for the build order.

## Branches and PRs

- Work happens on short-lived branches named `<type>/<short-name>` (`feat/plan-check`, `fix/card-overlap`), merged into `dev`, and `dev` goes to `main` by PR.
- PR titles follow the same Conventional Commits format as commits.
- Merge with a merge commit so the small logical commits are kept.

## Before you push

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Style: no em dashes anywhere (docs, comments, UI copy), and code comments are casual lowercase.
