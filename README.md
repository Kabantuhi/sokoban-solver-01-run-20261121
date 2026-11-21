# Sokoban solver — push-optimal, room by room

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/Kabantuhi/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/Kabantuhi/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

Entry for the make.fun **sokoban-solver-01-run-20261121** bounty ($100 prize pool,
10 places × $10; entries close Monday 23 November 2026, 11:00 WITA).

One program, `main.ts`, answers a set of 5 Sokoban levels in the fewest pushes
possible. Every level this competition draws is a hallway with 1–4 rooms off
it, each room holding 3–4 boxes and as many goals, and no box can ever leave
its room — so a level's push-optimum is the sum of its rooms' optima. The
solver splits a level into its rooms and solves each room push-optimally with
A* over macro-pushes, using a min-cost box→goal assignment as its heuristic
(admissible and consistent, so the search is optimal), with live-square and
frozen 2×2 deadlock pruning. Rooms are stitched back together in scan order;
the player walks on from where the last room left it.

## Results

- Practice set (kit): **1,000,000 / 1,000,000** — all 5 levels solved in
  exactly P* pushes (13, 16, 29, 47, 60), verified with the kit's own checker.
- Cross-check vs the kit's own push-optimal oracle on 175 freshly generated
  levels (35 sets): **175/175 optimal**, 0 mismatches.
- Runtime: ~0.5 s for a 5-level set (budget 60 s); deterministic — two runs
  write byte-identical solutions.

## Run it

```sh
node main.ts
```

Reads `$MAKEFUN_INPUT_DIR` (default `/input`, one `level.txt` per instance
id) and writes `$MAKEFUN_OUTPUT_DIR` (default `/output`, one `solution.txt`
of u/d/l/r moves per instance id). Plain JavaScript in a `.ts` file — Node 22
runs it as-is, no install, no network, no clock, no randomness.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=c45jj78w&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
