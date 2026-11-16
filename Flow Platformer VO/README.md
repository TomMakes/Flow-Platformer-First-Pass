# Flow Platformer — first playable

An endless side-scrolling browser platformer. Each segment of the level is three stacked
routes: harder on top, matched to you in the middle, easier on the bottom. A search bot
solves and scores every chunk before it reaches the game, and a live skill estimate `s`
decides which chunks you get next. The demo exists to tune one thing: which generation and
difficulty formula keeps a player in flow.

Built from *Flow Platformer — Build Plan for First Playable*.

## Run it

```bash
npm install
npm run dev      # open the printed URL (usually http://localhost:5173)
npm test         # 22 tests, about 90 s (the session tests play whole games headlessly)
npm run build    # type-check and production build
```

No runtime dependencies. Dev dependencies are Vite, TypeScript and Vitest only.

## Controls

| Key | Action |
| --- | --- |
| A / D or arrow keys | Move |
| Space, W or Up | Jump (hold for a higher jump) |
| H | Toggle the full debug HUD / minimal HUD |
| G | Toggle the bot ghost: each chunk's clean run replayed as an outline |
| R | Restart with a new seed |

Moving between routes: holes in the top or middle floor drop you one lane. To climb, stop
under the light-blue one-way tiles at the start of a segment, jump into the hanging wall
and wall-jump up through them.

## URL parameters

| Parameter | Effect |
| --- | --- |
| `?seed=123` | Reproducible session: the same seed and the same inputs give the same session. A random seed is written into the URL on load. |
| `?mode=fixed` | Milestone-2 mode: unscored chunks at fixed lane intensities 0.7 / 0.4 / 0.1. |
| `?level=test` | Milestone-1 sandbox: the hand-written test level (hole, tall wall, mud, bumper, one-way ledge). |

## Tuning

In the browser console, `flow` is the live session (`flow.tracker.s`, `flow.director.bank`, …).

Every constant is in `src/tuning.ts`. Start with the HUD (H): it shows `s`, the three lane
targets, the D of the chunks on screen, the last scored outcome and time ratio, the bank by
D bin (the yellow line marks `s`), bank misses, worker ms per chunk and the discard rate.

## Layout

```
src/
  tuning.ts        every constant
  sim/             pure simulation: types, physics step, grid helpers, seeded RNG, test level
  gen/             generator, route field, bot, scorer, generation core and web worker
  game/            session (DOM-free game state), world, director/bank, tracker, input, render, main
tests/             physics, bot, scorer, and whole-session tests
```

`sim/` and `gen/` never touch the DOM, `Math.random`, `Date` or `performance.now`, and never
import from `game/`. The game loop, the bot and the scorer all call the same `step`.

## Milestone checks (all verified)

1. **Movement.** Jump apex 3.56 tiles (discrete integration of the plan's -12 / 0.6), full-speed
   jump 7.3 tiles, each wall hop gains 2.4–2.5 tiles, a six-tile wall takes one jump plus at most
   two wall jumps, a six-tile hole has a wide take-off window, runs are deterministic.
2. **Endless three-lane world.** Gates, drop-through holes, lane-2 pits, segment discard. Memory
   stays flat (about 2 MB of heap) over a five-minute browser soak at 60 fps.
3. **Bot.** Solves the test level including the six-tile wall by wall jumps, returns null for a
   ten-tile hole, solves a flat chunk in 196 frames.
4. **Scorer.** Flat chunk D = 0. D rises with hole width (2 and 3 tie near 0, then 4, 5, 6 climb).
   Same chunk, same D. Over 200 chunks, correlation with intensity ≈ 0.6 and D spans 0.0–1.0.
5. **Worker, bank, adaptive lanes.** 60 fps with the worker running; no bank misses; falling
   into every hole pulls `s` down within five chunks; clean runs push `s` above 0.5 within ten.
6. **HUD and seed.** Every HUD number listed in the plan is live; `?seed=` reproduces a session.

## Where this differs from the plan, and why

- **Clean runs are centred.** Beam search always finds the latest possible jump (it only compares
  progress), so jitter scoring measured the bot's luck: a two-tile hole scored like a five-tile
  one. After solving, each input change is moved to the middle of the timings that still clear
  its manoeuvre, so D measures how wide the timing window is (`centreRun` in `gen/bot.ts`).
- **Jitter levels are 3/6/9/12 frames** (plan: 2/4/6/8). With ±8 frames no hole up to four tiles
  wide can ever fail, so holes 2–4 all scored the same. The plan lists jitter levels as the knob.
- **Bot ranking and de-duplication.** States are ranked by the route distance at the apex they are
  already heading for, and de-duplicated in 16 px / 4 px-per-frame buckets (plan: 8 / 2). With the
  plan's settings, right after a wall jump the climbing states looked worse than states sliding
  down the wall and were pruned; half of all six-tall walls were unsolvable. Ties now prefer fewer
  jump presses, so the bot does not hop on flat ground.
- **Every lane has the gate's hanging wall, and the bot simulates it.** The bot used to solve chunks
  without the wall at column 3, so an early jump in lanes 1 and 2 hit it in the real world. Lane 0
  gets the same wall (with nothing above to climb to), so a bot-solvable chunk is solvable in any lane.
- **Obstacles start at column 6** (plan: 4). A hole at columns 4–5 can't be jumped without hitting
  the gate wall; this cut discards from 37% to under 3%.
- **Lane targets keep their spacing at the ends.** Near s = 0.95 the plan's clamp put lanes 0 and 1
  both at 0.95, which can't be strictly ordered. The triple now shifts as a whole (top lane at most
  0.95, always 0.15 apart).
- **Segment picking is a small joint search** over the nearest 24 chunks per lane, using the plan's
  rules (lane 2 nearest; each lane above nearer its target, harder than the lane below, and legal
  against it). The greedy order sometimes stranded a lane and fell back to a flat chunk.
- **Generation runs in deterministic epochs.** To make `?seed=` reproducible with a worker, the
  worker generates a fixed number of chunks per epoch (36 at startup, then 12 per segment) from the
  state sent at each segment assembly, and segment k only draws on epochs before k. Timing can
  never change which chunks a segment gets. If an epoch were ever late the game would wait with
  "Generating…"; in practice an epoch finishes in about half a second and a segment takes 3.6 s
  to cross. The worker keeps one intensity bias per D bin instead of a single bias.
- **Startup** waits for the first epoch (36 chunks), which more than covers the plan's
  "12 chunks, 3 near each target" condition.
- **Lane-2 pits are 3 tiles deep**, as the plan's text says (its row table made them 4). At 4 deep a
  full jump (3.56 tiles) can't clear the rim, so escaping took a precise wall-jump sequence; a
  scripted player sat in one for five minutes. Now a plain jump while holding right gets out.
- **Tracker fairness.** The time ratio subtracts the head start a player gets by starting a chunk
  past the bot's start column.
