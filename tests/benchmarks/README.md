# Predicate Benchmark Harness

These scripts measure predicate and room-render performance for the stable `test:predicates` fixture.

## Commands

- `npm run bench:all` prints benchmark tables.
- `npm run bench:record` writes/updates `predicate-baseline.json`.
- `npm run bench:check` compares current numbers against the baseline and fails on notable regressions.

## If `bench:check` fails

A failing check usually means one of three things:

1. A real slowdown was introduced.
2. The machine had temporary noise (background load, thermal throttling, power mode).
3. Behavior changed intentionally and the baseline is now stale.

Recommended flow:

1. Run `npm run bench:check` again once.
2. If it still fails, run `npm run bench:all` to see which case moved.
3. If the slowdown is expected, run `npm run bench:record` and commit the updated baseline.

See `docs/PredicatePerformanceGuide.md` for fuller guidance.
