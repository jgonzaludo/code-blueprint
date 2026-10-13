# Benchmarks

Opt-in check of the core parser against a real checkout. Not part of `pnpm test`.

```bash
BLUEPRINT_BENCH_ROOT=/path/to/src BLUEPRINT_BENCH_OUT=/tmp/report.json pnpm --filter @blueprint/core test real-repo
```

Env knobs: `BLUEPRINT_BENCH_TESTS=1` keeps test files in, `BLUEPRINT_BENCH_NO_DIAG=1` skips the type error count.

## M1 run: remeda

Repo `remeda/remeda`, commit `8e6e78f`, parsed `packages/remeda/src` with no `node_modules` installed (so unresolved externals show up as type errors, which are counted and ignored). Apple silicon laptop, Node 24, TypeScript 5.9.3, cold single run.

| Setup | Files | Blocks | Edges | File edges | Type errors | Parse time |
|---|---|---|---|---|---|---|
| tests and `*.test-d.ts` excluded | 225 | 832 | 205 | 611 | 100 | about 1.1 s |
| everything, including tests | 539 | 1542 | 5609 | 1336 | 871 | about 5.0 s |

Notes:

- Two `*.test-d.ts` files (type-level tests) cost about 1.5 s on their own, because resolving calls inside heavy conditional types makes the checker work hard. So `parseTree` takes an `exclude` option and nothing is excluded by default. Whether tests belong on the map by default is a product call.
- All edges resolved through the checker, none by name match.
- Hand check: 6 sampled arrows (call line and target line) were all correct against the source. Calls to `purry` are 102 edges, and 102 source files call `purry(` directly, so none were missed.
