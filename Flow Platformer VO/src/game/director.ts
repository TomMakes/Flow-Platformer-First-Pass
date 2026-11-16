import { T } from '../tuning';
import { encodeInput, type Chunk } from '../sim/types';
import { solveChunk } from '../gen/bot';
import { scoreChunk } from '../gen/scorer';
import { hashSeed } from '../sim/rng';
import { flatChunk, generateChunk } from '../gen/generator';
import { binOf, epochSize } from '../gen/genCore';
import { assemblyOk } from './world';

const DC = T.director;

/** Where scored chunks come from: a web worker in the browser, a synchronous core in tests. */
export interface ChunkFeed {
  /** Tell the generator the state as of `epoch`; it then produces that epoch's chunks. */
  sendState(epoch: number, s: number, binCounts: number[]): void;
  /** Chunks that arrived since the last call. */
  drain(): Chunk[];
}

/** s + 0.15, s, s - 0.15, clamped to [0, 0.95]. Near the ends the triple shifts as a
 *  whole instead of squashing, so the three lanes always stay 0.15 apart and ordered. */
export const laneTargets = (s: number): [number, number, number] => {
  const o = DC.laneOffset;
  const mid = Math.max(o, Math.min(DC.targetMax - o, s));
  return [mid + o, mid, mid - o];
};

/** A flat chunk that already carries its clean-run score. */
let FLAT: Chunk | null = null;
export function scoredFlat(): Chunk {
  if (!FLAT) {
    const c = flatChunk(0);
    const run = solveChunk(c)!;
    FLAT = { ...c, score: scoreChunk(c, run), run: Uint8Array.from(run.inputs, encodeInput) };
  }
  return { ...FLAT, tiles: FLAT.tiles.slice(), score: { ...FLAT.score } };
}

export type Pick = { chunks: [Chunk, Chunk, Chunk]; targets: [number, number, number]; misses: number };

/** Adaptive mode: a bank of scored chunks, filled epoch by epoch, drawn from at the last moment. */
export class Director {
  bank: Chunk[] = [];
  inbox = new Map<number, Chunk[]>();
  admitted = -1; // highest epoch admitted into the bank
  misses = 0;
  received = 0;

  constructor(public feed: ChunkFeed, s0: number) {
    feed.sendState(0, s0, new Array(DC.bins).fill(0));
  }

  pull(): void {
    for (const c of this.feed.drain()) {
      const e = c.epoch ?? 0;
      if (!this.inbox.has(e)) this.inbox.set(e, []);
      this.inbox.get(e)!.push(c);
      this.received++;
    }
  }

  epochReady(e: number): boolean {
    return e <= this.admitted || (this.inbox.get(e)?.length ?? 0) >= epochSize(e);
  }

  /** Segment k (k >= 1) is built from epochs 0 .. k-1. */
  canAssemble(k: number): boolean {
    this.pull();
    for (let e = this.admitted + 1; e <= k - 1; e++) if (!this.epochReady(e)) return false;
    return true;
  }

  admitThrough(e: number, s: number): void {
    for (let q = this.admitted + 1; q <= e; q++) {
      const list = (this.inbox.get(q) ?? []).sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
      for (const c of list) this.addToBank(c, s);
      this.inbox.delete(q);
      this.admitted = q;
    }
  }

  addToBank(c: Chunk, s: number): void {
    this.bank.push(c);
    if (this.bank.length > DC.bankMax) {
      let worst = 0;
      for (let i = 1; i < this.bank.length; i++)
        if (Math.abs(this.bank[i].score.D - s) > Math.abs(this.bank[worst].score.D - s)) worst = i;
      this.bank.splice(worst, 1);
    }
  }

  binCounts(): number[] {
    const b = new Array(DC.bins).fill(0);
    for (const c of this.bank) b[binOf(c.score.D)]++;
    return b;
  }

  /** The startup condition from the plan: enough chunks near every starting lane target. */
  startupOk(s: number): boolean {
    this.pull();
    const all = [...this.bank, ...[...this.inbox.values()].flat()];
    if (all.length < DC.startupMin) return false;
    return laneTargets(s).every((t) => all.filter((c) => Math.abs(c.score.D - t) <= DC.startupNearDist).length >= DC.startupNear);
  }

  /** Choose the three chunks of segment k for skill s. Call only when canAssemble(k). */
  select(k: number, s: number): Pick {
    this.admitThrough(k - 1, s);
    const targets = laneTargets(s);
    const [l0, l1, l2] = this.pickTriple(targets);
    const misses = [l0, l1, l2].filter((c) => c === null).length;
    const chosen = [l0 ?? scoredFlat(), l1 ?? scoredFlat(), l2 ?? scoredFlat()] as [Chunk, Chunk, Chunk];
    for (const c of [l0, l1, l2]) if (c) this.bank.splice(this.bank.indexOf(c), 1);
    this.misses += misses;
    this.feed.sendState(k, s, this.binCounts());
    return { chunks: chosen, targets, misses };
  }

  /**
   * Lane 2 nearest its target; lane 1 nearest with higher D and legal against lane 2;
   * lane 0 likewise against lane 1. Searched jointly over the few nearest candidates per
   * lane (the plan's greedy order, but without letting one early choice strand a lane).
   */
  pickTriple(t: [number, number, number]): [Chunk | null, Chunk | null, Chunk | null] {
    const K = DC.selectCandidates;
    const near = (target: number, ok: (c: Chunk) => boolean, exclude: Chunk[] = []) =>
      this.bank.filter((c) => !exclude.includes(c) && ok(c))
        .sort((a, b) => Math.abs(a.score.D - target) - Math.abs(b.score.D - target)).slice(0, K);
    let best: [Chunk | null, Chunk | null, Chunk | null] = [null, null, null];
    let bestCost = Infinity;
    const MISS = 10; // a missing lane costs more than any distance
    const c2s = near(t[2], () => true);
    if (c2s.length === 0) return best;
    for (const c2 of c2s) {
      const c1s = near(t[1], (c) => c.score.D > c2.score.D && assemblyOk(c.tiles, c2.tiles), [c2]);
      for (const c1 of c1s.length ? c1s : [null]) {
        const below = c1 ?? c2;
        const c0 = near(t[0], (c) => c.score.D > below.score.D && (c1 ? assemblyOk(c.tiles, c1.tiles) : true), [c1, c2].filter(Boolean) as Chunk[])[0] ?? null;
        const cost = Math.abs(c2.score.D - t[2]) + (c1 ? Math.abs(c1.score.D - t[1]) : MISS) + (c0 ? Math.abs(c0.score.D - t[0]) : MISS);
        if (cost < bestCost) { bestCost = cost; best = [c0, c1, c2]; }
      }
    }
    return best;
  }
}

/** Milestone-2 mode: unscored chunks at fixed lane intensities. */
export class FixedDirector {
  misses = 0;
  constructor(public seed: number) {}
  canAssemble(): boolean { return true; }
  select(k: number): Pick {
    const I = DC.fixedIntensities;
    const mk = (lane: number, attempt: number) => generateChunk(hashSeed(this.seed, k * 1000 + lane * 100 + attempt), I[lane]);
    let tries = 0;
    for (;;) {
      const l2 = mk(2, tries), l1 = mk(1, tries), l0 = mk(0, tries);
      tries++;
      if ((assemblyOk(l0.tiles, l1.tiles) && assemblyOk(l1.tiles, l2.tiles)) || tries > 50) {
        for (const [c, i] of [[l0, I[0]], [l1, I[1]], [l2, I[2]]] as const) c.score = { ...c.score, D: i };
        return { chunks: [l0, l1, l2], targets: [I[0], I[1], I[2]], misses: 0 };
      }
    }
  }
}
