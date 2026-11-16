import { T } from '../tuning';
import { ChunkGrid } from '../sim/grid';
import { step } from '../sim/physics';
import { hashSeed, mulberry32, randInt } from '../sim/rng';
import type { Chunk, ChunkScore, CleanRun, Input, PlayerState } from '../sim/types';
import { buildField, sampleField } from './field';

const S = T.score;
const TS = T.tile;
const FLOOR = T.chunkH - 1;

type Manoeuvre = { a: number; b: number }; // frame span [a, b) of the clean run

/** Checkpoints are frame 0 and every landing frame; short spans merge into the one after them. */
export function manoeuvres(run: CleanRun): Manoeuvre[] {
  const bounds: number[] = [0];
  for (let i = 1; i < run.frames; i++) {
    if (run.trace[i]!.grounded && !run.trace[i - 1]!.grounded) bounds.push(i);
  }
  bounds.push(run.frames);
  let k = 0;
  while (k < bounds.length - 1) {
    if (bounds[k + 1]! - bounds[k]! < S.minManoeuvre && bounds.length > 2) {
      if (k + 2 < bounds.length) bounds.splice(k + 1, 1); // merge into the one after
      else bounds.splice(k, 1); // last one: merge into the previous
      k = Math.max(0, k - 1);
    } else k++;
  }
  const out: Manoeuvre[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) out.push({ a: bounds[i]!, b: bounds[i + 1]! });
  return out;
}

const sameInput = (p: Input, q: Input) => p.dir === q.dir && p.jump === q.jump;

/** Shift every input change by a random whole number of frames in [-J, +J], keeping order. */
function jitterInputs(clean: Input[], J: number, rng: () => number): Input[] {
  const L = clean.length;
  const changes: number[] = [];
  for (let i = 1; i < L; i++) if (!sameInput(clean[i]!, clean[i - 1]!)) changes.push(i);
  const shifted: number[] = [];
  let prev = 0;
  for (const c of changes) {
    const v = Math.max(prev, Math.max(0, Math.min(L, c + randInt(rng, -J, J))));
    shifted.push(v);
    prev = v;
  }
  const out: Input[] = [];
  let j = 0;
  for (let f = 0; f < L; f++) {
    while (j < shifted.length && shifted[j]! <= f) j++;
    out.push(j === 0 ? clean[0]! : clean[changes[j - 1]!]!);
  }
  return out;
}

type Trial = { fell: boolean; loss: number };

function runTrial(
  grid: ChunkGrid, field: Float32Array, start: PlayerState, inputs: Input[], cleanLen: number, targetValue: number,
): Trial {
  let s = start;
  const total = inputs.length + S.recoveryFrames;
  for (let f = 0; f < total; f++) {
    const input = f < inputs.length ? inputs[f]! : { dir: 1 as const, jump: false };
    s = step(s, input, grid);
    if (s.y >= (FLOOR + 1) * TS) return { fell: true, loss: 0 };
    if (s.grounded) {
      const v = sampleField(field, s.x + T.playerW / 2, s.y + T.playerH / 2);
      if (v <= targetValue + S.successTiles) return { fell: false, loss: Math.max(0, f + 1 - cleanLen) };
    }
  }
  return { fell: false, loss: S.stallPenalty };
}

/**
 * Replay the bot's clean run with imperfect timing, one manoeuvre at a time, and combine the fall
 * rate and time loss into the chunk's difficulty D. Seeded from the chunk seed: always the same score.
 */
export function scoreChunk(chunk: Chunk, run: CleanRun, field: Float32Array = buildField(chunk.tiles)): ChunkScore {
  const grid = new ChunkGrid(chunk.tiles);
  const T0 = run.frames;
  let survive = 1;
  let extra = 0;
  manoeuvres(run).forEach((m, mi) => {
    const start = run.trace[m.a]!;
    const end = run.trace[m.b]!;
    const target = sampleField(field, end.x + T.playerW / 2, end.y + T.playerH / 2);
    const clean = run.inputs.slice(m.a, m.b);
    let falls = 0, trials = 0, lossSum = 0, lossN = 0;
    for (const J of S.jitterLevels) {
      for (let t = 0; t < S.trialsPerLevel; t++) {
        // Common random numbers: the shifts depend on manoeuvre index, level and trial only, so similar chunks
        // are graded against the same jitter and D varies smoothly with the geometry. Still deterministic per chunk.
        const rng = mulberry32(hashSeed(0x5eed, mi, J, t));
        const r = runTrial(grid, field, start, jitterInputs(clean, J, rng), m.b - m.a, target);
        trials++;
        if (r.fell) falls++;
        else { lossSum += r.loss; lossN++; }
      }
    }
    survive *= 1 - falls / trials;
    extra += lossN ? lossSum / lossN : 0;
  });
  const pFall = 1 - survive;
  const expectedFrames = T0 + extra;
  const flow = T0 / expectedFrames;
  const D = Math.max(0, Math.min(1, 1 - (1 - pFall) * flow));
  return { T0, pFall, expectedFrames, flow, D };
}
