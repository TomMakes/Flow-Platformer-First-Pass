import { T } from '../tuning';
import { hashSeed } from '../sim/rng';
import type { Chunk } from '../sim/types';
import { ghostOf, solveChunk } from './bot';
import { generateChunk } from './generator';
import { buildField } from './field';
import { scoreChunk } from './scorer';

const R = T.runtime;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const binOf = (D: number) => Math.min(R.binCount - 1, Math.max(0, Math.floor(D * R.binCount)));

/** The worker's brain, free of any messaging so it can be tested directly. */
export class ChunkProducer {
  private counter = 0;
  s: number = T.tracker.startS;
  binCounts: number[] = new Array<number>(R.binCount).fill(0);
  bias = 0;
  solved = 0;
  discarded = 0;

  constructor(private baseSeed: number) {}

  reset(baseSeed: number): void {
    this.baseSeed = baseSeed;
    this.counter = 0;
    this.s = T.tracker.startS;
    this.binCounts.fill(0);
    this.bias = 0;
    this.solved = 0;
    this.discarded = 0;
  }

  setState(s: number, binCounts: number[]): void {
    this.s = s;
    this.binCounts = binCounts.slice();
  }

  /** The bin within s +- 0.3 with the fewest chunks in the bank; ties go to the bin nearest s. */
  pickBin(): number {
    let best = -1;
    for (let b = 0; b < R.binCount; b++) {
      const centre = (b + 0.5) / R.binCount;
      if (Math.abs(centre - this.s) > R.binWindow) continue;
      if (
        best < 0 ||
        this.binCounts[b]! < this.binCounts[best]! ||
        (this.binCounts[b] === this.binCounts[best] && Math.abs(centre - this.s) < Math.abs((best + 0.5) / R.binCount - this.s))
      ) best = b;
    }
    return best >= 0 ? best : binOf(this.s);
  }

  /** Generate, solve and score one chunk. Returns null when the bot cannot solve it (discarded). */
  produce(): Chunk | null {
    const bin = this.pickBin();
    const centre = (bin + 0.5) / R.binCount;
    const intensity = clamp(centre + this.bias, 0, 1);
    const seed = hashSeed(this.baseSeed, this.counter++);
    const chunk = generateChunk(seed, intensity);
    const field = buildField(chunk.tiles);
    const run = solveChunk(chunk, field);
    if (!run) {
      this.discarded++;
      return null;
    }
    chunk.score = scoreChunk(chunk, run, field);
    chunk.ghost = ghostOf(run);
    this.solved++;
    this.bias = clamp(this.bias + R.biasGain * (centre - chunk.score.D), -1, 1);
    this.binCounts[binOf(chunk.score.D)]!++;
    return chunk;
  }
}
