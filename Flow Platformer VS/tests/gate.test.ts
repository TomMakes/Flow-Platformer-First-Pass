import { describe, expect, it } from 'vitest';
import { T } from '../src/tuning';
import { flatChunk } from '../src/gen/generator';
import { laneFloorRow, World } from '../src/game/world';
import { makeStanding, step } from '../src/sim/physics';
import type { Input, PlayerState } from '../src/sim/types';

const TS = T.tile;

/** Small beam search: can the player get from lane `lane` up onto lane `lane - 1` through the gate? */
function canAscend(world: World, lane: number): { ok: boolean; frames: number } {
  const targetFeet = laneFloorRow(lane - 1) * TS; // standing on the one-way tiles
  let beam: PlayerState[] = [{ ...makeStanding(0.6 * TS, laneFloorRow(lane) * TS), vx: 0 }];
  const actions: Input[] = [];
  for (const dir of [1, 0, -1] as const) for (const jump of [true, false]) actions.push({ dir, jump });
  for (let round = 0; round < 120; round++) {
    const next = new Map<string, PlayerState>();
    for (const s of beam) {
      for (const a of actions) {
        let q = s;
        for (let k = 0; k < 4; k++) q = step(q, a, world);
        if (q.grounded && Math.abs(q.y + T.playerH - targetFeet) < 0.01 && q.x > 0) return { ok: true, frames: (round + 1) * 4 };
        const key = [q.x >> 3, q.y >> 3, Math.round(q.vx / 2), Math.round(q.vy / 2), q.grounded, q.jumpHeld].join();
        const prev = next.get(key);
        if (!prev || q.y < prev.y) next.set(key, q);
      }
    }
    beam = [...next.values()].sort((a, b) => a.y - b.y).slice(0, 80);
  }
  return { ok: false, frames: -1 };
}

describe('ascent gates', () => {
  const w = new World();
  w.addSegment([flatChunk(), flatChunk(), flatChunk()]);
  it('lane 2 -> lane 1 is reachable', () => {
    const r = canAscend(w, 2);
    console.log('lane 2 -> 1 frames', r.frames);
    expect(r.ok).toBe(true);
  });
  it('lane 1 -> lane 0 is reachable', () => {
    const r = canAscend(w, 1);
    console.log('lane 1 -> 0 frames', r.frames);
    expect(r.ok).toBe(true);
  });
});
