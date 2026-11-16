import { T } from '../tuning';
import { type Grid, type Input, type PlayerState } from '../sim/types';
import { step } from '../sim/physics';
import { randInt } from '../sim/rng';
import { type CleanRun } from './bot';

const S = T.scorer;
const RECOVER: Input = { dir: 1, jump: false };
const FLOOR_BOTTOM = (T.chunkFloorRow + 1) * T.tile;

export type Manoeuvre = { a: number; b: number }; // frames [a, b)

/** Split the clean run at landings; merge spans shorter than the minimum into the next. */
export function manoeuvres(run: CleanRun): Manoeuvre[] {
  const cps = [0];
  for (let f = 1; f < run.frames; f++) if (run.trace[f].grounded && !run.trace[f - 1].grounded) cps.push(f);
  cps.push(run.frames);
  const spans: Manoeuvre[] = [];
  for (let k = 0; k + 1 < cps.length; k++) spans.push({ a: cps[k], b: cps[k + 1] });
  const merged: Manoeuvre[] = [];
  let pendingA = -1;
  for (const m of spans) {
    const a = pendingA >= 0 ? pendingA : m.a;
    if (m.b - a < S.minManoeuvre) { pendingA = a; continue; }
    merged.push({ a, b: m.b });
    pendingA = -1;
  }
  if (pendingA >= 0) {
    if (merged.length) merged[merged.length - 1].b = run.frames;
    else merged.push({ a: 0, b: run.frames });
  }
  return merged;
}

export const same = (p: Input, q: Input) => p.dir === q.dir && p.jump === q.jump;

/** Shift each input change in [a, b) by a random amount in [-J, J], keeping order. */
export function jitterInputs(inputs: Input[], a: number, b: number, J: number, r: () => number): Input[] {
  const changes: number[] = [];
  for (let f = a + 1; f < b; f++) if (!same(inputs[f], inputs[f - 1])) changes.push(f);
  const shifted: number[] = [];
  let prev = a;
  for (const c of changes) {
    const n = Math.max(prev + 1, c + randInt(r, -J, J));
    shifted.push(n);
    prev = n;
  }
  const len = Math.max(b - a, (shifted.length ? shifted[shifted.length - 1] : a) - a + 1);
  const out: Input[] = new Array(len);
  let ci = 0, cur = inputs[a];
  for (let k = 0; k < len; k++) {
    const f = a + k;
    while (ci < shifted.length && shifted[ci] <= f) { cur = inputs[changes[ci]]; ci++; }
    out[k] = cur;
  }
  return out;
}

export type TrialResult = { kind: 'success' | 'fall' | 'stall'; loss: number };

/** Play `ins` from `start`, then hold right for the recovery window, and classify. */
export function trialManoeuvre(
  grid: Grid, fieldOf: (s: PlayerState) => number, start: PlayerState,
  ins: Input[], target: number, clean: number,
): TrialResult {
  let s = start;
  const total = ins.length + S.recoveryFrames;
  for (let f = 0; f < total; f++) {
    s = step(s, f < ins.length ? ins[f] : RECOVER, grid);
    if (s.y >= FLOOR_BOTTOM) return { kind: 'fall', loss: 0 };
    if (s.grounded && fieldOf(s) <= target) return { kind: 'success', loss: Math.max(0, f + 1 - clean) };
  }
  return { kind: 'stall', loss: S.stallPenalty };
}
