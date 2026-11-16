import { T } from '../tuning';
import { ChunkGrid, type ArrayGrid, type TileGrid } from '../sim/grid';
import { makePlayer, step } from '../sim/physics';
import type { Chunk, CleanRun, Input, PlayerState } from '../sim/types';
import { buildField, sampleField } from './field';

const B = T.bot;
const TS = T.tile;
const FLOOR = T.chunkH - 1;

// Preferred actions first so ties resolve to "run right, no jump".
export const ACTIONS: Input[] = [];
for (const dir of [1, 0, -1] as const) for (const jump of [false, true]) ACTIONS.push({ dir, jump });

export function botStart(): PlayerState {
  return {
    ...makePlayer(T.startCol * TS - T.playerW / 2, FLOOR * TS - T.playerH),
    vx: T.maxRun,
    grounded: true,
    coyote: T.coyote,
  };
}

type Node = { state: PlayerState; value: number; cost: number; parent: number; action: number };

function bucketKey(s: PlayerState): string {
  const p = B.bucketPos, v = B.bucketVel;
  return `${Math.floor(s.x / p)},${Math.floor(s.y / p)},${Math.round(s.vx / v)},${Math.round(s.vy / v)},${s.grounded ? 1 : 0},${s.jumpHeld ? 1 : 0}`;
}

/** Everything the beam search needs to know about a level. */
export type SearchSpec = {
  grid: TileGrid;
  start: PlayerState;
  value: (s: PlayerState) => number; // route distance, lower is better
  atGoal: (s: PlayerState) => boolean;
  fell: (s: PlayerState) => boolean;
  stepLimit?: number;
};

/** Replay an action list to get per-frame inputs and the state trace. */
export function runActions(grid: TileGrid, start: PlayerState, actions: number[]): CleanRun {
  let s = start;
  const inputs: Input[] = [];
  const trace: PlayerState[] = [];
  for (const a of actions) {
    const input = ACTIONS[a]!;
    for (let k = 0; k < B.stepFrames; k++) {
      trace.push(s);
      inputs.push(input);
      s = step(s, input, grid);
    }
  }
  trace.push(s); // the final state, so trace.length === frames + 1
  return { inputs, trace, frames: inputs.length };
}

/**
 * Beam search over held inputs. Nodes keep a parent pointer and an action; the run is rebuilt once
 * at the end by replaying. Ties on route distance prefer fewer non-default actions.
 */
export function beamSearch(spec: SearchSpec): CleanRun | null {
  const nodes: Node[] = [{ state: spec.start, value: spec.value(spec.start), cost: 0, parent: -1, action: -1 }];
  let beam = [0];
  const limit = spec.stepLimit ?? B.stepLimit;
  for (let round = 0; round < limit; round++) {
    const cand = new Map<string, number>();
    for (const bi of beam) {
      const base = nodes[bi]!;
      for (let a = 0; a < ACTIONS.length; a++) {
        const input = ACTIONS[a]!;
        let s = base.state;
        let dead = false;
        for (let k = 0; k < B.stepFrames; k++) {
          s = step(s, input, spec.grid);
          if (spec.fell(s)) { dead = true; break; }
        }
        if (dead) continue;
        const value = spec.value(s);
        nodes.push({ state: s, value, cost: base.cost + (a === 0 ? 0 : 1), parent: bi, action: a });
        const ni = nodes.length - 1;
        if (spec.atGoal(s)) {
          const actions: number[] = [];
          for (let n = ni; n > 0; n = nodes[n]!.parent) actions.push(nodes[n]!.action);
          return runActions(spec.grid, spec.start, actions.reverse());
        }
        const key = bucketKey(s);
        const prev = cand.get(key);
        if (prev === undefined || value < nodes[prev]!.value) cand.set(key, ni);
      }
    }
    if (cand.size === 0) return null;
    // Rank by route distance, but keep half the beam for grounded states and half for airborne ones.
    // Otherwise every slot goes to early jumpers (the route rewards height) and the bot never
    // reaches the ground-level moves, such as a jump timed at a hole's edge.
    const byValue = (p: number, q: number) => {
      const np = nodes[p]!, nq = nodes[q]!;
      const dv = Math.round(np.value * 1000) - Math.round(nq.value * 1000);
      return dv || np.cost - nq.cost || p - q;
    };
    const all = [...cand.values()].sort(byValue);
    const grounded = all.filter((i) => nodes[i]!.state.grounded);
    const air = all.filter((i) => !nodes[i]!.state.grounded);
    const half = B.beamWidth >> 1;
    const take = new Set<number>([...grounded.slice(0, half), ...air.slice(0, half)]);
    for (const i of all) {
      if (take.size >= B.beamWidth) break;
      take.add(i);
    }
    beam = [...take].sort(byValue);
  }
  return null;
}

/** Fastest run through one chunk, or null when the chunk cannot be solved. */
export function solveChunk(chunk: Chunk, field: Float32Array = buildField(chunk.tiles)): CleanRun | null {
  return beamSearch({
    grid: new ChunkGrid(chunk.tiles),
    start: botStart(),
    value: (s) => sampleField(field, s.x + T.playerW / 2, s.y + T.playerH / 2),
    atGoal: (s) => s.grounded && s.x + T.playerW / 2 >= T.goalCol * TS,
    fell: (s) => s.y >= (FLOOR + 1) * TS,
  });
}

/** Solve an arbitrary rectangular grid from `startCol` on `floorRow` to `goalCol` (used for the test level). */
export function solveGrid(grid: ArrayGrid, startCol: number, floorRow: number, goalCol: number, stepLimit = 400): CleanRun | null {
  const field = buildField(grid.tiles, grid.w, grid.h, goalCol);
  const start: PlayerState = {
    ...makePlayer(startCol * TS - T.playerW / 2, floorRow * TS - T.playerH),
    vx: T.maxRun, grounded: true, coyote: T.coyote,
  };
  return beamSearch({
    grid,
    start,
    value: (s) => sampleField(field, s.x + T.playerW / 2, s.y + T.playerH / 2, grid.w, grid.h),
    atGoal: (s) => s.grounded && s.x + T.playerW / 2 >= goalCol * TS,
    fell: (s) => s.y >= (floorRow + 1) * TS,
    stepLimit,
  });
}

/** Centre positions of a clean run, two floats per frame, for the ghost overlay. */
export function ghostOf(run: CleanRun): Float32Array {
  const g = new Float32Array(run.trace.length * 2);
  run.trace.forEach((s, i) => {
    g[i * 2] = s.x + T.playerW / 2;
    g[i * 2 + 1] = s.y + T.playerH / 2;
  });
  return g;
}
