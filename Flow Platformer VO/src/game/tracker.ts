import { T } from '../tuning';
import { type Chunk, type PlayerState } from '../sim/types';
import { laneOfRow, type World } from './world';

const TR = T.tracker;
const TS = T.tile;

export type Outcome = 'clean' | 'rough' | 'failed';
export type ScoredResult = { seg: number; lane: number; outcome: Outcome; o: number; ratio: number; D: number; sBefore: number; sAfter: number; fell: boolean };

type Attempt = { seg: number; lane: number; startFrame: number; startCx: number; chunk: Chunk };

export const expectedOutcome = (s: number, D: number): number => 1 / (1 + Math.exp(-(s - D) / TR.eloScale));

export function classify(ratio: number): { outcome: Outcome; o: number } {
  if (ratio >= TR.cleanRatio) return { outcome: 'clean', o: 1 };
  if (ratio >= TR.roughRatio) return { outcome: 'rough', o: TR.roughValue };
  return { outcome: 'failed', o: 0 };
}

/** Per-chunk player performance and the skill estimate s. */
export class Tracker {
  s: number = TR.startS;
  scored = 0;
  attempt: Attempt | null = null;
  done = new Set<string>();
  history: ScoredResult[] = [];
  onUpdate: ((r: ScoredResult) => void) | null = null;

  get last(): ScoredResult | undefined { return this.history[this.history.length - 1]; }

  private apply(a: Attempt, o: number, outcome: Outcome, ratio: number, fell: boolean): void {
    const D = a.chunk.score.D;
    const k = this.scored < TR.kEarlyChunks ? TR.kEarly : TR.kLate;
    const sBefore = this.s;
    this.s = Math.max(0, Math.min(1, this.s + k * (o - expectedOutcome(this.s, D))));
    this.scored++;
    const r: ScoredResult = { seg: a.seg, lane: a.lane, outcome, o, ratio, D, sBefore, sAfter: this.s, fell };
    this.history.push(r);
    if (this.history.length > 200) this.history.shift();
    this.onUpdate?.(r);
  }

  update(p: PlayerState, world: World, frame: number): void {
    const cx = p.x + T.playerW / 2, cy = p.y + T.playerH / 2;
    const lane = laneOfRow(Math.floor(cy / TS));
    const col = cx / TS;
    const seg = Math.floor(col / T.chunkW);
    const local = col - seg * T.chunkW;
    const a = this.attempt;
    if (a) {
      if (lane > a.lane) { this.attempt = null; this.apply(a, 0, 'failed', 0, true); }
      else if (lane < a.lane) this.attempt = null; // ascended: not scored
      else if (seg > a.seg || (seg === a.seg && local >= TR.endCol)) {
        this.attempt = null;
        const frames = Math.max(1, frame - a.startFrame);
        const head = Math.max(0, (a.startCx - T.bot.startCol * TS) / T.maxRun);
        const ratio = Math.max(1, a.chunk.score.T0 - head) / frames;
        const { outcome, o } = classify(ratio);
        this.apply(a, o, outcome, ratio, false);
      }
    }
    if (!this.attempt && p.grounded && lane <= 2 && local >= TR.startCols[0] && local <= TR.startCols[1]) {
      const key = `${seg}:${lane}`;
      const s = world.segs.get(seg);
      if (s && !this.done.has(key)) {
        this.done.add(key);
        this.attempt = { seg, lane, startFrame: frame, startCx: cx - seg * T.chunkW * TS, chunk: s.chunks[lane] };
      }
    }
  }
}
