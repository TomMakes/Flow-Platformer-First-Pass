import { T } from '../tuning';
import { encodeInput, type Chunk } from '../sim/types';
import { hashSeed } from '../sim/rng';
import { generateChunk } from './generator';
import { solveChunk } from './bot';
import { scoreChunk } from './scorer';

const DC = T.director;

export const binOf = (D: number): number => Math.min(DC.bins - 1, Math.max(0, Math.floor(D * DC.bins)));
export const binCentre = (b: number): number => (b + 0.5) / DC.bins;
export const epochSize = (e: number): number => (e === 0 ? DC.epoch0Chunks : DC.epochChunks);

export type Snapshot = { epoch: number; s: number; binCounts: number[] };

/** Generate, solve and score one fully-formed chunk, or null if unsolvable. */
export function buildChunk(seed: number, intensity: number): Chunk | null {
  const c = generateChunk(seed, intensity);
  const run = solveChunk(c);
  if (!run) return null;
  c.score = scoreChunk(c, run);
  c.run = Uint8Array.from(run.inputs, encodeInput);
  return c;
}

/**
 * The generation stream. Deterministic: given the session seed and the sequence of
 * snapshots, it produces the same chunks in the same order, whatever the timing.
 */
export class GenCore {
  attempts = 0;
  produced = 0;
  discarded = 0;
  bias: number[] = new Array(DC.bins).fill(0);
  constructor(public sessionSeed: number) {}

  /** Yields the kept chunks of one epoch, one at a time. */
  *epoch(snap: Snapshot): Generator<Chunk> {
    const counts = snap.binCounts.slice();
    const lo = snap.s - DC.binWindow, hi = snap.s + DC.binWindow;
    let kept = 0;
    while (kept < epochSize(snap.epoch)) {
      let bin = -1;
      for (let b = 0; b < DC.bins; b++) {
        const c = binCentre(b);
        if (c < lo || c > hi) continue;
        if (bin < 0 || counts[b] < counts[bin]) bin = b;
      }
      if (bin < 0) bin = binOf(Math.max(0, Math.min(1, snap.s)));
      const centre = binCentre(bin);
      const intensity = Math.max(0, Math.min(1, centre + this.bias[bin]));
      const seed = hashSeed(this.sessionSeed, this.attempts++);
      const c = buildChunk(seed, intensity);
      if (!c) { this.discarded++; continue; }
      this.bias[bin] += DC.biasRate * (centre - c.score.D);
      counts[binOf(c.score.D)]++;
      c.n = this.produced++;
      c.epoch = snap.epoch;
      kept++;
      yield c;
    }
  }
}
