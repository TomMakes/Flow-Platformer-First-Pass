import { T } from '../tuning';
import { type Grid, type Input, type PlayerState } from '../sim/types';
import { step, playerOnFloor } from '../sim/physics';
import { ChunkGrid } from '../sim/grid';
import { chunkField, type Field } from './field';
import { manoeuvres, same, trialManoeuvre } from './replay';

export type CleanRun = {
  inputs: Input[]; // one per frame
  trace: PlayerState[]; // state at the start of each frame; trace[frames] is the final state
  frames: number; // T0, the clean completion time
};

/** Six actions, ordered so that ties favour simply running right. */
export const ACTIONS: Input[] = [
  { dir: 1, jump: false }, { dir: 1, jump: true },
  { dir: 0, jump: false }, { dir: 0, jump: true },
  { dir: -1, jump: false }, { dir: -1, jump: true },
];

type Node = { s: PlayerState; parent: Node | null; action: number; f: number; presses: number };

/** Lower route distance first; on ties, fewer jump presses (a calmer, more human run). */
const better = (p: Node, q: Node): number => p.f - q.f || p.presses - q.presses;

export type SearchOpts = {
  start: PlayerState;
  field: Field;
  isGoal: (s: PlayerState) => boolean;
  isDead: (s: PlayerState) => boolean;
  beam?: number;
  stepLimit?: number;
  stepFrames?: number;
};

const bucketKey = (s: PlayerState, P = T.bot.bucketPos, V = T.bot.bucketVel): string =>
  `${Math.floor(s.x / P)},${Math.floor(s.y / P)},${Math.floor(s.vx / V)},${Math.floor(s.vy / V)},${s.grounded ? 1 : 0}${s.jumpHeld ? 1 : 0}`;

const centre = (s: PlayerState) => [s.x + T.playerW / 2, s.y + T.playerH / 2] as const;

/** Beam search over held inputs, ranked by route-field distance. */
export function beamSearch(grid: Grid, o: SearchOpts): CleanRun | null {
  const beamW = o.beam ?? T.bot.beam, limit = o.stepLimit ?? T.bot.stepLimit, sf = o.stepFrames ?? T.bot.stepFrames;
  // Rank by route distance at the apex the state is already headed for: right after a
  // wall jump the bot is pushed away from the wall, and ranking by the current position
  // would prune exactly the states that are climbing.
  const score = (s: PlayerState) => {
    const [cx, cy] = centre(s);
    const rise = s.vy < 0 ? (s.vy * s.vy) / (2 * T.gravity) : 0;
    return Math.min(o.field.sample(cx, cy), o.field.sample(cx, Math.max(T.playerH / 2, cy - rise)));
  };
  let beam: Node[] = [{ s: o.start, parent: null, action: -1, f: score(o.start), presses: 0 }];
  for (let round = 0; round < limit; round++) {
    const next: Node[] = [];
    for (const n of beam) {
      for (let a = 0; a < ACTIONS.length; a++) {
        let s = n.s;
        for (let k = 0; k < sf; k++) s = step(s, ACTIONS[a], grid);
        if (o.isDead(s)) continue;
        const press = ACTIONS[a].jump && !n.s.jumpHeld ? 1 : 0;
        next.push({ s, parent: n, action: a, f: score(s), presses: n.presses + press });
      }
    }
    if (next.length === 0) return null;
    const goals = next.filter((n) => o.isGoal(n.s));
    if (goals.length) {
      goals.sort((p, q) => p.presses - q.presses || p.f - q.f);
      return rebuild(grid, o.start, goals[0], sf);
    }
    const best = new Map<string, Node>();
    for (const n of next) {
      const k = bucketKey(n.s);
      const b = best.get(k);
      if (!b || better(n, b) < 0) best.set(k, n);
    }
    beam = [...best.values()].sort(better).slice(0, beamW);
  }
  return null;
}

function rebuild(grid: Grid, start: PlayerState, end: Node, sf: number): CleanRun {
  const actions: number[] = [];
  for (let n: Node | null = end; n && n.action >= 0; n = n.parent) actions.push(n.action);
  actions.reverse();
  const inputs: Input[] = [];
  const trace: PlayerState[] = [start];
  let s = start;
  for (const a of actions) for (let k = 0; k < sf; k++) { inputs.push(ACTIONS[a]); s = step(s, ACTIONS[a], grid); trace.push(s); }
  return { inputs, trace, frames: inputs.length };
}

const FLOOR_BOTTOM = (T.chunkFloorRow + 1) * T.tile;
export const chunkFell = (s: PlayerState): boolean => s.y >= FLOOR_BOTTOM;
export const chunkGoal = (s: PlayerState): boolean => s.grounded && s.x + T.playerW / 2 >= T.bot.goalCol * T.tile;
export const chunkStart = (): PlayerState => playerOnFloor(T.bot.startCol, T.chunkFloorRow, T.maxRun);

/** Find a fast run through a 40 x 9 chunk, or null if none exists within the step limit. */
export function solveChunk(chunk: { tiles: Uint8Array }): CleanRun | null {
  const grid = new ChunkGrid(chunk.tiles);
  const field = chunkField(grid);
  const run = beamSearch(grid, { start: chunkStart(), field, isGoal: chunkGoal, isDead: chunkFell });
  return run && centreRun(grid, field, run, chunkGoal, chunkFell);
}

const CENTRE_RANGE = T.bot.centreRange;
const CENTRE_LOSS = T.bot.centreLoss;
const RECOVER: Input = { dir: 1, jump: false };

/** Replay inputs from the start; return the run up to the first goal frame, or null. */
function replayToGoal(grid: Grid, start: PlayerState, inputs: Input[], isGoal: (s: PlayerState) => boolean, isDead: (s: PlayerState) => boolean): CleanRun | null {
  const trace = [start];
  const used: Input[] = [];
  let s = start;
  for (let f = 0; f < inputs.length + T.scorer.recoveryFrames; f++) {
    const inp = f < inputs.length ? inputs[f] : RECOVER;
    s = step(s, inp, grid);
    used.push(inp); trace.push(s);
    if (isDead(s)) return null;
    if (isGoal(s)) return { inputs: used, trace, frames: used.length };
  }
  return null;
}

/**
 * Move each input change to the centre of the window of timings that still clear
 * its manoeuvre. The beam search finds the latest-possible jump (it only ever
 * compares progress), which makes jitter scoring measure the bot's luck rather
 * than the obstacle; centring makes D measure how wide the timing window is.
 */
export function centreRun(grid: Grid, field: Field, run: CleanRun, isGoal: (s: PlayerState) => boolean, isDead: (s: PlayerState) => boolean): CleanRun {
  const fieldOf = (s: PlayerState) => field.sample(s.x + T.playerW / 2, s.y + T.playerH / 2);
  let cur = run;
  let c = 1;
  while (c < cur.frames) {
    const ins = cur.inputs;
    if (same(ins[c], ins[c - 1])) { c++; continue; }
    let prevC = 0; for (let f = c - 1; f >= 1; f--) if (!same(ins[f], ins[f - 1])) { prevC = f; break; }
    let nextC = cur.frames; for (let f = c + 1; f < cur.frames; f++) if (!same(ins[f], ins[f - 1])) { nextC = f; break; }
    const m = manoeuvres(cur).find((q) => c >= q.a && c < q.b) ?? { a: 0, b: cur.frames };
    const target = fieldOf(cur.trace[m.b]) + T.scorer.successTiles;
    const works = (d: number): boolean => {
      const nc = c + d;
      if (nc <= Math.max(prevC, m.a) || nc >= nextC) return false;
      const sh = ins.slice(m.a, m.b);
      if (d < 0) for (let f = nc; f < c; f++) sh[f - m.a] = ins[c];
      else for (let f = c; f < nc && f < m.b; f++) sh[f - m.a] = ins[c - 1];
      const r = trialManoeuvre(grid, fieldOf, cur.trace[m.a], sh, target, m.b - m.a);
      return r.kind === 'success' && r.loss <= CENTRE_LOSS;
    };
    let lo = 0, hi = 0;
    while (lo > -CENTRE_RANGE && works(lo - 1)) lo--;
    while (hi < CENTRE_RANGE && works(hi + 1)) hi++;
    const d = Math.round((lo + hi) / 2);
    if (d !== 0) {
      const moved = ins.slice();
      const nc = c + d;
      if (d < 0) for (let f = nc; f < c; f++) moved[f] = ins[c];
      else for (let f = c; f < nc; f++) moved[f] = ins[c - 1];
      const re = replayToGoal(grid, run.trace[0], moved, isGoal, isDead);
      if (re) { cur = re; c = nc + 1; continue; }
    }
    c++;
  }
  return cur;
}
