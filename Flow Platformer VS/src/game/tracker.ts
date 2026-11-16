import { T } from '../tuning';
import type { Chunk, PlayerState } from '../sim/types';
import { World } from './world';

const K = T.tracker;
const TS = T.tile;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Probability-like expectation that a player of skill s completes a chunk of difficulty D cleanly. */
export const expectedOutcome = (s: number, D: number) => 1 / (1 + Math.exp(-(s - D) / K.scale));

/** Elo-style update. */
export const updateSkill = (s: number, D: number, o: number, k: number) => clamp01(s + k * (o - expectedOutcome(s, D)));

export type OutcomeKind = 'clean' | 'rough' | 'failed' | 'fell';
export type Outcome = {
  kind: OutcomeKind;
  o: number;
  ratio: number; // T0 / player frames, 0 for a fall
  D: number;
  segment: number;
  lane: number;
  sBefore: number;
  sAfter: number;
};

type Active = { seg: number; lane: number; frames: number; chunk: Chunk };

/** Scores the player on each chunk attempted and keeps the skill estimate s. */
export class Tracker {
  s: number = K.startS;
  scored = 0;
  last: Outcome | null = null;
  active: Active | null = null;

  reset(): void {
    this.s = K.startS;
    this.scored = 0;
    this.last = null;
    this.active = null;
  }

  private apply(a: Active, kind: OutcomeKind, o: number, ratio: number): Outcome {
    const k = this.scored < K.earlyCount ? K.kEarly : K.kLate;
    const sBefore = this.s;
    this.s = updateSkill(this.s, a.chunk.score.D, o, k);
    this.scored++;
    this.active = null;
    this.last = { kind, o, ratio, D: a.chunk.score.D, segment: a.seg, lane: a.lane, sBefore, sAfter: this.s };
    return this.last;
  }

  /** Call once per physics step, after the player has moved. Returns an outcome when one just happened. */
  update(p: PlayerState, world: World): Outcome | null {
    const cx = p.x + T.playerW / 2;
    const cy = p.y + T.playerH / 2;
    const col = cx / TS;
    const lane = World.laneOfRow(Math.floor(cy / TS));
    const segIdx = Math.floor(col / T.segW);
    const local = col - segIdx * T.segW;

    if (!this.active) {
      if (p.grounded && lane <= 2 && local < 5) {
        const chunk = world.segments.get(segIdx)?.chunks[lane];
        if (chunk && chunk.score.T0 > 0) this.active = { seg: segIdx, lane, frames: 0, chunk };
      }
      return null;
    }

    const a = this.active;
    a.frames++;
    if (lane > a.lane) return this.apply(a, 'fell', 0, 0); // left the lane downward (a lane 2 pit counts)
    if (lane < a.lane || col < a.seg * T.segW - 1) { this.active = null; return null; } // climbed or went back: not scored
    if (segIdx === a.seg && local >= T.goalCol) {
      const ratio = a.chunk.score.T0 / a.frames;
      if (ratio >= K.cleanRatio) return this.apply(a, 'clean', 1, ratio);
      if (ratio >= K.roughRatio) return this.apply(a, 'rough', K.roughOutcome, ratio);
      return this.apply(a, 'failed', 0, ratio);
    }
    if (segIdx > a.seg) { this.active = null; return null; }
    return null;
  }
}
