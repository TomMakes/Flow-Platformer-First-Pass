# Flow Platformer — Build Plan for First Playable

## 1. Goal and scope

Build an endless side-scrolling browser platformer whose level is generated during play as three stacked routes: harder on top, matched to the player in the middle, easier on the bottom. The demo exists to answer one question: which generation and difficulty-adjustment formula keeps a player in flow.

**Note to the implementing model:** build the milestones in section 10 in order and verify each before starting the next. Every number in this plan is a starting value, kept in one tuning file. Do not add a game framework or runtime dependencies.

**In scope**

- Movement: run, variable-height jump, wall slide, wall jump, full air control.
- Obstacles: holes, walls, slow zones, bumpers. Nothing deals damage and nothing kills.
- A search bot that solves each generated chunk and scores its mechanical difficulty.
- A live skill estimate for the player that sets the difficulty of upcoming routes.
- A debug HUD showing the numbers behind every decision.

**Out of scope**

- Art, sound, menus, saving, mobile and gamepad input.
- Enemies, combat, pickups, and any Dead Cells mechanic beyond the list above.
- Neural networks or any trained model. The bot is search only.

**Definitions**

| Term | Meaning |
| --- | --- |
| Lane | One of three horizontal routes: 0 = top (harder), 1 = middle (matched), 2 = bottom (easier) |
| Chunk | One lane's worth of level for one segment: a 40 x 9 tile grid |
| Segment | Three chunks stacked vertically; the world is a row of segments |
| D | A chunk's mechanical difficulty, 0 (trivial) to 1 (near impossible), measured by the bot |
| s | The player's current skill estimate, on the same 0 to 1 scale as D |

## 2. Stack and project structure

Use Vite, TypeScript in strict mode, and the Canvas 2D API. Vitest is the only dev dependency beyond Vite and TypeScript. There are no runtime dependencies.

The physics module is the centre of the project. The game loop, the bot and the scorer all call the same `step` function, so a chunk the bot can finish is a chunk the player can finish.

```
src/
  tuning.ts          every constant in this plan, one exported object
  sim/
    types.ts         PlayerState, Input, Tile, Chunk
    physics.ts       step(state, input, grid): PlayerState   (pure)
    grid.ts          tile lookup, AABB-versus-tile collision helpers
    rng.ts           mulberry32 seeded PRNG
  gen/
    generator.ts     generateChunk(seed, intensity): Chunk
    field.ts         route distance field (BFS from the goal)
    bot.ts           solveChunk(chunk): CleanRun | null
    scorer.ts        scoreChunk(chunk, cleanRun): ChunkScore
    worker.ts        generate, solve, score, post results
  game/
    main.ts          fixed-timestep loop, bootstraps everything
    input.ts         keyboard to Input
    world.ts         segments, lane assembly, tile lookup in world space
    director.ts      chunk bank, lane targets, segment assembly
    tracker.ts       per-chunk player performance, skill estimate s
    render.ts        rectangles, camera, debug HUD
tests/
  physics.test.ts  bot.test.ts  scorer.test.ts
```

**Rules for the sim and gen folders**

- No DOM access, no `Math.random`, no `Date` or `performance.now`. All randomness comes from `rng.ts` with an explicit seed.
- `step` never mutates its input state; it returns a new state object. The bot depends on cheap, safe copies.
- Nothing in `sim/` or `gen/` imports from `game/`.

## 3. Movement and physics

The simulation advances in fixed steps of 1/60 second. All speeds are in pixels per frame and all durations are in frames. The game loop uses an accumulator so that rendering rate never changes the physics.

**Input and state**

```ts
type Input = { dir: -1 | 0 | 1; jump: boolean };   // jump = button held this frame

type PlayerState = {
  x: number; y: number;            // top-left of the hitbox, pixels
  vx: number; vy: number;
  grounded: boolean;
  wallDir: -1 | 0 | 1;             // side of a touching wall while airborne
  coyote: number;                  // frames left to jump after leaving ground
  buffer: number;                  // frames a jump press stays queued
  jumpHeld: boolean;               // last frame's jump input, for edge detection
  wallLock: number;                // frames of ignored dir input after a wall jump
  bumperCooldown: number;
};
```

**Order of operations inside `step`**

1. Detect a jump press (jump is true and `jumpHeld` was false) and set `buffer`.
2. Apply horizontal acceleration toward `dir`, or friction if `dir` is 0 and grounded. Ignore `dir` while `wallLock` is above 0.
3. If `buffer` is above 0: ground jump when grounded or `coyote` is above 0; otherwise wall jump when `wallDir` is not 0.
4. If jump is released while `vy` is negative, multiply `vy` by the jump-cut factor once.
5. Apply gravity. If sliding on a wall while holding toward it, cap fall speed at the wall-slide speed.
6. Move on X and resolve tile collisions, then move on Y and resolve. Update `grounded` and `wallDir`.
7. Apply tile effects: mud under the feet, bumper overlap.
8. Decrement the timers.

**Starting constants**

| Constant | Value | Notes |
| --- | --- | --- |
| Tile size | 32 px |  |
| Player hitbox | 20 x 40 px |  |
| Max run speed | 6 px/frame | About 11 tiles per second |
| Ground and air acceleration | 0.6 px/frame² | Same value gives full air control |
| Ground friction | 0.8 px/frame² | Only when no direction is held |
| Gravity | 0.6 px/frame² |  |
| Max fall speed | 14 px/frame |  |
| Jump velocity | -12 px/frame | Apex about 3.75 tiles; about 7.5 tiles of distance at full speed |
| Jump-cut factor | 0.5 | Variable jump height |
| Coyote time | 6 frames |  |
| Jump buffer | 6 frames |  |
| Wall-slide fall cap | 2.5 px/frame |  |
| Wall jump velocity | 5.5 away, -11 up |  |
| Wall lock | 4 frames | Then full air control returns |
| Mud speed factor | 0.5 | Applied to max run speed while standing on mud |
| Bumper knockback | vx -7, vy -5 | Then 30 frames before it can trigger again |

**Feel targets to tune against**

- Climbing a single wall by repeated wall jumps works, and each hop gains two to three tiles. This is the Dead Cells behaviour the player likes.
- A six-tile wall is cleared with one jump and at most two wall jumps.
- A six-tile hole is cleared at full speed with a few frames to spare on both sides of the jump.

## 4. World model

The world is a tile grid 31 rows tall that grows to the right one segment at a time. Each segment is 40 tiles wide and holds three chunks, one per lane.

```
row  0-7    lane 0 interior   (harder)
row  8      lane 0 floor  = lane 1 ceiling
row  9-16   lane 1 interior   (matched)
row 17      lane 1 floor  = lane 2 ceiling
row 18-25   lane 2 interior   (easier)
row 26      lane 2 floor
row 27-29   pit space under lane 2 holes
row 30      solid
```

Anything above row 0 counts as solid. Segments more than two behind the player are discarded.

**Tiles**

| Tile | Solid | Effect |
| --- | --- | --- |
| EMPTY | No |  |
| SOLID | Yes |  |
| ONEWAY | Only from above | The player passes up through it and lands on top of it |
| MUD | Yes | Halves max run speed while the player stands on it |
| BUMPER | No | Knocks the player back on overlap |

**Chunks**

A chunk is a 40 x 9 grid: rows 0 to 7 are the interior and row 8 is the floor. The first four and last four columns are always flat, clear floor. They give a run-up, a landing, and room for the ascent gate.

```ts
type Chunk = {
  seed: number;
  intensity: number;        // generator input, 0..1
  tiles: Uint8Array;        // 40 * 9, row-major
  score: ChunkScore;        // from the scorer, section 7
};
```

**Moving between lanes**

- **Down, by failing.** A hole in the floor of lane 0 or lane 1 drops the player into the lane below. No reset and no pause.
- **Down, in lane 2.** A hole opens into a pit three tiles deep. The player wall-jumps out. It costs time and nothing else.
- **Up, by choice.** Every segment starts with an ascent gate in lanes 1 and 2: ONEWAY tiles at columns 1 and 2 of the ceiling, and a SOLID wall hanging from the ceiling at column 3, five tiles long. Running underneath is free. To ascend, the player jumps into the hanging wall and wall-jumps up through the ONEWAY tiles.

The gate is added by the world when a segment is assembled. It is not part of any chunk, and the bot never scores it.

**Assembly rule**

A fall from a hole can drift up to six tiles forward. When choosing chunks for a segment, reject a combination where a hole in one lane has another hole in the lane below anywhere from its first column to six columns past its last. This prevents an unavoidable double fall.

Segment 0 is three flat chunks with ascent gates, so the player can learn the movement. The player starts in lane 1.

## 5. Chunk generator

`generateChunk(seed, intensity)` builds one chunk from a seed and a single intensity value between 0 and 1. Intensity is only a hint to the generator. The chunk's real difficulty is whatever the bot measures afterwards.

**Obstacles**

| Obstacle | Shape | Range |
| --- | --- | --- |
| Hole | EMPTY tiles in the floor row | 2 to 6 tiles wide |
| Wall | SOLID column rising from the floor | 1 or 2 wide, 1 to 6 tall |
| Mud | MUD tiles replacing floor | 2 to 6 tiles long |
| Bumper | One BUMPER tile | On the floor, or 2 to 3 tiles above it |

**Placement**

1. Start with a flat floor and an empty interior.
2. Put a cursor at column 4. Pick an obstacle type, size it from the table below, and place it at the cursor.
3. Advance the cursor by the obstacle's width plus a spacing value, and repeat until the cursor passes column 35.
4. With probability equal to intensity minus 0.4 (when positive), attach a modifier to an obstacle: a raised bumper above a hole, or mud on the run-up to a hole or wall.

**How intensity shapes a chunk**

| Parameter | At intensity 0 | At intensity 1 |
| --- | --- | --- |
| Hole width | 2 | 6 |
| Wall height | 1 | 6 |
| Spacing between obstacles | 8 tiles | 2 tiles |
| Share of obstacles that are traps (mud, bumper) | 20% | 50% |

Interpolate linearly and add a random offset of plus or minus one tile to sizes, clamped to the legal range. An intensity of 0 with a low roll may produce a nearly flat chunk, which is fine for the bottom lane.

**Validity**

A chunk is kept only if the bot finds a complete run through it (section 6). Unsolvable chunks are thrown away and never reach the game.

## 6. Search bot

`solveChunk(chunk)` finds a fast run through one chunk by beam search over held inputs, ranked by progress along the route. It returns the run, or null if the chunk cannot be solved.

The bot simulates a chunk on its own: everything above row 0 and left of column 0 is solid, and a player whose hitbox drops fully below the floor row has fallen.

**Route distance field (`field.ts`)**

Ranking by horizontal distance would prune wall climbs, because climbing makes no horizontal progress. Rank by distance along the route instead.

1. Mark every non-solid tile in column 38 as distance 0.
2. Breadth-first search outward through non-solid tiles, four-connected. Each tile gets its step count from the goal.
3. To score a state, sample the field at the player's centre with bilinear interpolation over the neighbouring non-solid tiles. Fall back to the nearest tile's value when a neighbour is solid.

Lower is better. Climbing a wall reduces the value because the path over the wall is the shortest path to the goal.

**Search**

| Setting | Value |
| --- | --- |
| Start state | Centre at column 1.5, standing on the floor, moving right at max run speed |
| Step length | 4 frames with one input held |
| Actions per step | 6: dir in {-1, 0, 1} x jump in {held, released} |
| Beam width | 40 |
| Step limit | 150 steps (600 frames) |
| Goal | Grounded with centre at or past column 38 |

Each round:

1. Expand every state in the beam by all six actions, calling `step` four times per action. Drop states that fell.
2. If any state meets the goal, stop. The run that got there first is the answer.
3. Remove near-duplicates: bucket states by x and y to 8 px, vx and vy to 2 px/frame, plus `grounded` and `jumpHeld`. Keep the best-ranked state per bucket.
4. Sort by field value and keep the best 40.

A jump press happens when a step with jump held follows a step with jump released. A wall climb is therefore press, release, press across consecutive steps.

**Output**

```ts
type CleanRun = {
  inputs: Input[];          // one per frame
  trace: PlayerState[];     // state at the start of each frame
  frames: number;           // T0, the clean completion time
};
```

Store a parent pointer and an action on each search node. Rebuild `inputs` and `trace` once at the end by replaying from the start, instead of copying arrays during the search.

**Known bias**

Four-frame steps mean the bot cannot find runs that need tighter timing than that. Such chunks are discarded as unsolvable. This errs toward fair chunks, which is the right direction for a flow demo.

## 7. Difficulty and flow scoring

`scoreChunk(chunk, cleanRun)` replays the bot's run with imperfect timing and reports how often it falls and how much time it loses. Those two numbers combine into D.

**Why the replay is split into manoeuvres**

Replaying a whole run with shifted inputs does not work. One late jump moves every later input out of position, so everything after the first obstacle fails, which is not how a person plays. A person recovers between obstacles. The scorer therefore tests each manoeuvre separately, always starting from the clean run's state.

**Manoeuvres**

1. A checkpoint is frame 0 and every landing frame in the clean trace (grounded now, airborne the frame before).
2. A manoeuvre is the span from one checkpoint to the next, so it holds a run-up and the jump or climb that follows.
3. Merge any manoeuvre shorter than 10 frames into the one after it.

**One jittered trial of one manoeuvre**

1. Start from the clean trace's state at the manoeuvre's first frame.
2. Take the clean inputs for the manoeuvre and find every frame where `dir` or `jump` changes. Shift each change by a random whole number of frames between -J and +J, keeping the changes in order.
3. Simulate the shifted inputs. When they run out, hold right with no jump for up to 30 recovery frames.
4. Classify the result:

| Result | Condition | Time loss |
| --- | --- | --- |
| Success | Grounded with a field value within one tile of the clean run's value at the next checkpoint | Frames taken minus the manoeuvre's clean length, never below 0 |
| Fall | The hitbox dropped below the floor row | Not applicable |
| Stall | Neither of the above before the recovery frames ran out | 60 frames, standing in for a retry |

Run 16 trials per manoeuvre, four each at J = 2, 4, 6 and 8 frames. Mixing jitter levels grades difficulty smoothly; a single level would sort chunks into only easy and impossible. Seed the trials from the chunk seed so a chunk always scores the same.

**Chunk score**

```ts
type ChunkScore = {
  T0: number;              // clean run length in frames
  pFall: number;           // 1 - product over manoeuvres of (1 - fall rate)
  expectedFrames: number;  // T0 + sum over manoeuvres of mean time loss in non-fall trials
  flow: number;            // T0 / expectedFrames
  D: number;               // 1 - (1 - pFall) * flow
};
```

D measures execution precision only. Dividing by the clean time means a long climb is not rated hard just for being slow; it is rated hard only if imperfect timing costs time or causes a fall. A flat chunk scores D = 0.

Stalls from the earlier design are captured here as time loss. A bump that stops the player shows up as extra frames, and a failure to get past shows up as the 60-frame penalty.

## 8. Player tracking and lane selection

The game keeps one number for the player, the skill estimate s, and updates it after every chunk the player attempts. The three lanes of each new segment are aimed at s + 0.15, s, and s - 0.15.

**Scoring the player on a chunk (`tracker.ts`)**

- Tracking starts when the player is grounded in a lane within columns 0 to 4 of a chunk.
- It ends in a **completion** when the player's centre passes column 38 in the same lane, or in a **fall** when the player leaves the lane downward. Dropping into a lane 2 pit counts as a fall.
- A player who arrives mid-chunk, after falling from above, is not scored for the rest of that chunk.

Each attempt becomes an outcome o:

| Outcome | Condition | o |
| --- | --- | --- |
| Clean | Completed, and T0 / player frames is 0.8 or more | 1 |
| Rough | Completed, and the ratio is between 0.55 and 0.8 | 0.5 |
| Failed | Fell, or the ratio is below 0.55 | 0 |

**Updating the skill estimate**

This is an Elo-style update. It compares the outcome with what was expected for a player of skill s on a chunk of difficulty D.

```ts
const expected = 1 / (1 + Math.exp(-(s - D) / 0.12));
s = clamp(s + k * (o - expected), 0, 1);
```

| Setting | Value |
| --- | --- |
| Starting s | 0.25 |
| k for the first 4 scored chunks | 0.30 |
| k afterwards | 0.12 |

The update handles route choice without a special case. A clean run on a chunk well above s raises s sharply, and a clean run on a chunk well below s barely moves it. The large early k is what lets a veteran reach a challenging level within the first few chunks. Falls are applied the moment they happen, not at the end of the chunk.

**Choosing chunks for a segment (`director.ts`)**

1. Compute targets: lane 0 = s + 0.15, lane 1 = s, lane 2 = s - 0.15, each clamped to 0 through 0.95.
2. For lane 2, take the unused chunk in the bank whose D is closest to the target.
3. For lane 1 and then lane 0, take the closest chunk that also passes the assembly rule against the lane below and has a higher D than the lane below.
4. Remove the chosen chunks from the bank.
5. If the bank has nothing usable for a lane, use a flat chunk and count a bank miss on the HUD.

## 9. Runtime architecture

A web worker generates and scores chunks continuously into a bank, and the main thread picks from the bank at the last moment. Generation never blocks a frame, and each segment uses the newest skill estimate.

**Why a bank instead of generating on request**

Solving and scoring one chunk costs roughly 100,000 physics steps, likely tens of milliseconds. Producing three well-matched lanes on request would mean dozens of candidates per segment and a delay of seconds. With a bank, the candidates are already scored when the segment is needed.

**Worker loop (`worker.ts`)**

1. Divide D from 0 to 1 into ten bins. Find the bin within s - 0.3 to s + 0.3 that has the fewest chunks in the bank.
2. Set intensity to that bin's centre plus a bias, clamped to 0 through 1.
3. Generate a chunk, solve it, and score it. Discard it if unsolvable.
4. Nudge the bias so intensity tracks measured difficulty: `bias += 0.1 * (binCentre - D)`.
5. Post the chunk to the main thread, then yield with `setTimeout(0)` so incoming messages are handled.

**Messages**

| Direction | Message | Purpose |
| --- | --- | --- |
| Main to worker | `{ type: "state", s, binCounts }` | Sent after every skill update and every segment assembly |
| Worker to main | `{ type: "chunk", chunk }` | One scored chunk, with `tiles` transferred |
| Worker to main | `{ type: "stats", solved, discarded, msPerChunk }` | For the HUD, once per second |

**Bank (`director.ts`)**

- Holds up to 150 chunks. When full, evict the chunk whose D is farthest from s.
- At startup, show "Generating" and wait until the bank holds at least 12 chunks, with at least 3 within 0.1 of each starting lane target.

**Segment assembly timing**

Assemble the next segment when its left edge is 30 tiles ahead of the player, which is just off-screen. Each segment then reflects every chunk result up to about one segment back.

**Game loop (`main.ts`)**

- Accumulate real time and run `step` in fixed 1/60 second increments, at most 5 per rendered frame.
- Each step: read input, step the player against the world grid, update the tracker, then let the director check whether a segment is due.
- Render after stepping.

**Rendering and camera (`render.ts`)**

- Canvas is 1280 x 720, showing 40 x 22.5 tiles. Draw tiles and the player as flat coloured rectangles, with one colour per tile type.
- The camera keeps the player one third from the left edge and follows vertically with smoothing, so lane changes are easy to read.
- Tint each lane's floor by its chunk's D so the player can see which route is harder.

**Controls**

| Key | Action |
| --- | --- |
| A / D or arrow keys | Move |
| Space, W or Up | Jump |
| H | Toggle debug HUD |
| G | Toggle bot ghost: replay each chunk's clean run as an outline |
| R | Restart with a new seed |

**Debug HUD**

Show s, the three lane targets and the actual D of the chunks on screen, the outcome and time ratio of the last scored chunk, bank size per bin, bank misses, worker milliseconds per chunk, and the discard rate. This HUD is the main tool for judging which formula feels right, so build it before tuning anything.

## 10. Milestones

Six milestones, each ending in something that can be checked. Milestone 2 is already a playable game; milestones 3 to 5 add the adaptive behaviour.

1. **Movement on a test level.** Build `tuning.ts`, `sim/`, the game loop, input, and rendering. Hand-write one test grid with a hole, a tall wall, mud, a bumper and a ONEWAY ledge.

   Check: the three feel targets in section 3 hold. Physics tests pass for jump apex height, jump distance at full speed, wall-hop height gain, and identical output from two runs with the same inputs.
2. **Endless three-lane world with unscored chunks.** Build the generator, `world.ts`, ascent gates, holes that drop to the lane below, lane 2 pits, the camera, and segment discard. Give lanes fixed intensities of 0.7, 0.4 and 0.1.

   Check: the player can run indefinitely, fall from lane 0 to lane 2, and climb back to lane 0 through two gates. Memory stays flat over five minutes.
3. **Search bot.** Build `field.ts` and `bot.ts`. Add the ghost overlay on G, running the bot on the main thread for now.

   Check: the bot solves the milestone 1 test grid, including the six-tile wall by wall jumps. It returns null for a chunk with a ten-tile hole. A flat chunk is solved in about 196 frames (36.5 tiles at 6 px/frame, rounded up to a whole 4-frame step).
4. **Scorer.** Build `scorer.ts`.

   Check: a flat chunk scores D below 0.02. For chunks with one hole, D rises with hole width from 2 to 6. The same chunk scores the same D on every run. Over 200 generated chunks, the correlation between intensity and D is positive, and D spreads across at least 0.05 to 0.7.
5. **Worker, bank, and adaptive lanes.** Move generation into `worker.ts`. Build the bank, `tracker.ts` and the director's selection. Replace the fixed lane intensities.

   Check: the frame rate holds at 60 while the worker runs. Bank misses stay at zero after startup during normal play. Deliberately falling into every hole pulls s down within five chunks, and clean runs in lane 0 push it up within five chunks.
6. **HUD and tuning pass.** Finish the debug HUD and the lane tint. Confirm every constant in this plan lives in `tuning.ts`. Add a `?seed=` URL parameter so a session can be reproduced.

   Check: every number listed under Debug HUD in section 9 is visible and updates live.

If time runs short, ship after milestone 5 with a minimal HUD showing only s and the three lane D values.

## 11. Acceptance criteria and known risks

The demo is done when a person can play for five minutes without a hitch and watch the lanes settle around their skill.

**Acceptance criteria**

- [ ] `npm run dev` starts the game and `npm test` passes.
- [ ] The game holds 60 frames per second in Chrome on a mid-range laptop, with no visible pause when segments appear.
- [ ] Every chunk that reaches the game was solved by the bot.
- [ ] Nothing kills or resets the player. Every failure leads to an easier route or a short time cost.
- [ ] On screen, lane 0 has a higher D than lane 1, and lane 1 a higher D than lane 2, in at least 9 of 10 segments.
- [ ] A player who runs cleanly in lane 0 sees s rise above 0.5 within the first ten chunks.
- [ ] A player who struggles sees s fall and the lanes visibly simplify within five chunks.
- [ ] The same `?seed=` value with the same inputs reproduces the same session.

**Known risks**

| Risk | Effect | First thing to try |
| --- | --- | --- |
| Scoring is too slow | The bank runs dry and flat chunks appear | Lower beam width to 24, then trials per manoeuvre to 8 |
| Bot difficulty does not match human difficulty | Lanes feel misordered | Compare HUD outcomes with D, then change the jitter levels or the 60-frame stall penalty |
| s swings too much | Difficulty lurches between segments | Lower the later k from 0.12, or widen the 0.12 divisor in the expected-outcome formula |
| The D range is too narrow | The three lanes feel alike | Widen the generator's size ranges or raise the lane offset above 0.15 |
| Ascent gates are too slow or too fiddly | Players stop climbing | Shorten the hanging wall or raise wall-jump height |
| Falling lands the player in a trap | Failure feels punishing | Extend the assembly rule to keep walls and bumpers out of the landing zone |

**After the demo**

The bot's scores for every generated chunk are training data. Once a formula feels right, a small model can learn to predict D directly from a chunk, which removes the search cost when mechanics and chunk sizes grow.
