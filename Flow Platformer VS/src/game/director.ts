import { T } from '../tuning';
import { assemblyOk, flatChunk, generateChunk } from '../gen/generator';
import { hashSeed } from '../sim/rng';
import type { Chunk } from '../sim/types';

/** Fixed lane intensities, unscored chunks, no bank. Kept for tests and the `?fixed=1` debug mode. */
export function fixedSegment(baseSeed: number, index: number): [Chunk, Chunk, Chunk] {
  if (index === 0) return [flatChunk(), flatChunk(), flatChunk()];
  const [i0, i1, i2] = T.runtime.fixedIntensities as number[];
  const pick = (lane: number, intensity: number, below: Chunk | null): Chunk => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const c = generateChunk(hashSeed(baseSeed, index, lane, attempt), intensity);
      if (!below || assemblyOk(c, below)) return c;
    }
    return flatChunk();
  };
  const c2 = pick(2, i2!, null);
  const c1 = pick(1, i1!, c2);
  const c0 = pick(0, i0!, c1);
  return [c0, c1, c2];
}

const R = T.runtime;
const K = T.tracker;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type Pick = {
  chunks: [Chunk, Chunk, Chunk];
  targets: [number, number, number];
  misses: number; // lanes that had to use a flat chunk
  missLanes: number[];
};

/** The bank of scored chunks and the lane selection that draws from it. */
export class Director {
  bank: Chunk[] = [];
  misses = 0;

  clear(): void {
    this.bank = [];
    this.misses = 0;
  }

  add(chunk: Chunk, s: number): void {
    this.bank.push(chunk);
    while (this.bank.length > R.bankMax) {
      let worst = 0;
      for (let i = 1; i < this.bank.length; i++) {
        if (Math.abs(this.bank[i]!.score.D - s) > Math.abs(this.bank[worst]!.score.D - s)) worst = i;
      }
      this.bank.splice(worst, 1);
    }
  }

  binCounts(): number[] {
    const counts = new Array<number>(R.binCount).fill(0);
    for (const c of this.bank) counts[Math.min(R.binCount - 1, Math.floor(c.score.D * R.binCount))]!++;
    return counts;
  }

  static targets(s: number): [number, number, number] {
    const o = K.laneOffset;
    return [clamp(s + o, 0, K.targetMax), clamp(s, 0, K.targetMax), clamp(s - o, 0, K.targetMax)];
  }

  /** At startup: at least 12 chunks, and 3 within 0.1 of each lane target. */
  ready(s: number): boolean {
    if (this.bank.length < R.startBankMin) return false;
    return Director.targets(s).every(
      (t) => this.bank.filter((c) => Math.abs(c.score.D - t) <= R.startNearTol).length >= R.startNearCount,
    );
  }

  /**
   * Choose three chunks for a segment and remove them from the bank.
   * Lane 2 first (closest D to its target), then lane 1 and lane 0: each must be the closest chunk that
   * passes the assembly rule against the lane below and has a higher D. If the greedy choice leaves a
   * lane with nothing usable, back up and try the next-closest lane 2 / lane 1 chunk (a bounded search)
   * before giving up and using a flat chunk.
   */
  pick(s: number): Pick {
    const targets = Director.targets(s);
    const BRANCH = 8;
    const byCloseness = (target: number, ok: (c: Chunk) => boolean, skip: Set<Chunk>): Chunk[] =>
      this.bank
        .filter((c) => !skip.has(c) && ok(c))
        .sort((p, q) => Math.abs(p.score.D - target) - Math.abs(q.score.D - target));
    const above = (below: Chunk) => (c: Chunk) => assemblyOk(c, below) && c.score.D > below.score.D;

    let best: [Chunk | null, Chunk | null, Chunk | null] = [null, null, null];
    let bestCount = -1;
    const consider = (t: [Chunk | null, Chunk | null, Chunk | null]) => {
      const n = t.filter(Boolean).length;
      if (n > bestCount) { best = t; bestCount = n; }
    };

    search: for (const c2 of [...byCloseness(targets[2], () => true, new Set()).slice(0, BRANCH), null]) {
      const used2 = new Set<Chunk>(c2 ? [c2] : []);
      const lane1 = c2 ? byCloseness(targets[1], above(c2), used2).slice(0, BRANCH) : byCloseness(targets[1], () => true, used2).slice(0, 1);
      for (const c1 of [...lane1, null]) {
        const used1 = new Set<Chunk>(used2);
        if (c1) used1.add(c1);
        const base = c1 ?? c2;
        const c0 = byCloseness(targets[0], base ? above(base) : () => true, used1)[0] ?? null;
        consider([c0, c1, c2]);
        if (bestCount === 3) break search;
      }
    }

    const used = new Set<Chunk>(best.filter((c): c is Chunk => c !== null));
    const missLanes: number[] = [];
    const out = best.map((c, lane) => {
      if (c) return c;
      missLanes.push(lane);
      return flatChunk();
    }) as [Chunk, Chunk, Chunk];
    this.bank = this.bank.filter((c) => !used.has(c));
    this.misses += missLanes.length;
    return { chunks: out, targets, misses: missLanes.length, missLanes };
  }
}
