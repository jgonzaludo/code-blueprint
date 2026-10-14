# Roadmap: parser and internal mechanics

The engine is `@blueprint/core` (parse, graph, diff, plan, layout, call tree) plus the CLI state and server that feed the window. Product and UI work is in [ROADMAP-product.md](ROADMAP-product.md).

Nothing here is promised, this is the list of known gaps and where to look next.

## Parsing and edges

| Area | Today | Next |
| --- | --- | --- |
| TypeScript calls | resolved with the type checker | keep the golden tests green when the compiler is bumped |
| Untyped JavaScript | edges by name match, can over or under connect | rank candidates by import path before falling back to bare names |
| Class methods | ids look like `Class.method`, the parser and sketches must agree on the spelling | accept `Class.method` as a sketch name so a claim on a method matches the real block |
| Re-exports and barrel files | followed when the checker can resolve them | test deep barrel chains and `export *` |
| Default exports and anonymous functions | named by file or variable | decide a stable id so a rename does not look like delete plus add |
| JSX components | treated like functions | edges for components used in JSX, not only called |
| Inheritance and interfaces | blocks exist, edges are thin | extends and implements as their own edge kind, drawn differently |
| Path aliases and project references | read from tsconfig | verify a monorepo with several tsconfigs |
| Dynamic calls (`obj[name]()`, callbacks) | missed | mark as unknown rather than silently dropping, so the map does not claim a clean graph |

## Plan and check

| Area | Today | Next |
| --- | --- | --- |
| Plan file format | blocks, edges, sketches, review state, baseline under `.blueprint/plans/<id>/base` | write the format down as a versioned spec |
| Sketches | a planned name before the code exists, matched when the real block lands | clearer message when a sketch name is rejected, and a way to drop a sketch and its claim cleanly |
| Check result | confirmed, missing, unplanned counts, call lines | show why a claim was not matched, not only that it was not |
| Plan lifecycle | drafting, ready, approved, changes, then complete | close a plan automatically once every claim is confirmed and nothing is unplanned |
| Baselines | HEAD or disk | handle a rebased or amended HEAD without a stale baseline |

## Performance

| Area | Today | Next |
| --- | --- | --- |
| Full parse | one TypeScript program per project | incremental reparse of changed files |
| Large repos | focus mode above 60 files | measure on the repos in `docs/BENCHMARKS.md` and set the focus threshold from data |
| Layout | ELK, positions cached in `.blueprint/layout.json` | keep positions stable when files are added so the map does not jump |
| Watcher | native recursive watch, 150 ms debounce | confirm behaviour on Linux and Windows watchers |

## Server and state

| Area | Today | Next |
| --- | --- | --- |
| Local server | 127.0.0.1 only, Host header check, token cookie, read only | keep it that way, review again before a VS Code webview talks to it |
| One watcher per project | `.blueprint/server.json` plus a liveness check | clean up a stale `server.json` when the process is gone |
| Snapshots | single file offline map | include the plan view in a snapshot |

## Quality

- Keep the golden tests (`refund-demo`, the section 13 call tree) as the contract for the parser.
- Add a fixture per gap above before fixing it, so each one has a failing test first.
- Keep the real browser tests for anything drawn on the map, since arrows and zoom are easy to break without noticing.
- Demo files under `examples/` are test fixtures. Do not edit them from a working session, copy them to a temp folder first.
