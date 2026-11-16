import { describe, expect, it } from 'vitest';
import { T } from '../src/tuning';
import { ArrayGrid } from '../src/sim/grid';
import { makePlayer, step } from '../src/sim/physics';
import { Tile, type Input, type PlayerState } from '../src/sim/types';
import { makeTestLevel, TEST_FLOOR_ROW } from '../src/game/testlevel';

const TS = T.tile;
const IDLE: Input = { dir: 0, jump: false };

function flat(w = 80, floorRow = 10, h = 14): ArrayGrid {
  const g = new ArrayGrid(w, h, new Uint8Array(w * h));
  for (let c = 0; c < w; c++) for (let r = floorRow; r < h; r++) g.set(c, r, Tile.SOLID);
  return g;
}
function stand(x: number, floorRow: number): PlayerState {
  return { ...makePlayer(x, floorRow * TS - T.playerH), grounded: true, coyote: T.coyote };
}
function settle(p: PlayerState, g: ArrayGrid, n = 5): PlayerState {
  for (let i = 0; i < n; i++) p = step(p, IDLE, g);
  return p;
}

describe('physics', () => {
  it('is deterministic and never mutates its input', () => {
    const g = makeTestLevel();
    const script = (i: number): Input => ({ dir: i % 50 < 30 ? 1 : -1, jump: i % 17 < 8 });
    const run = () => {
      let p = settle(stand(3 * TS, TEST_FLOOR_ROW), g);
      const frozen = JSON.stringify(p);
      const trace: string[] = [];
      for (let i = 0; i < 600; i++) {
        const before = JSON.stringify(p);
        const q = step(p, script(i), g);
        expect(JSON.stringify(p)).toBe(before);
        p = q;
        trace.push(JSON.stringify(p));
      }
      expect(frozen).toBeTruthy();
      return trace;
    };
    expect(run()).toEqual(run());
  });

  it('jump apex is about 3.75 tiles', () => {
    const g = flat();
    let p = settle(stand(10 * TS, 10), g);
    const startY = p.y;
    let minY = p.y;
    for (let i = 0; i < 60; i++) {
      p = step(p, { dir: 0, jump: true }, g);
      minY = Math.min(minY, p.y);
    }
    const tiles = (startY - minY) / TS;
    expect(tiles).toBeGreaterThan(3.4);
    expect(tiles).toBeLessThan(3.9);
  });

  it('variable jump: tapping gives a lower jump than holding', () => {
    const g = flat();
    const apex = (hold: number) => {
      let p = settle(stand(10 * TS, 10), g);
      const y0 = p.y;
      let minY = p.y;
      for (let i = 0; i < 60; i++) {
        p = step(p, { dir: 0, jump: i < hold }, g);
        minY = Math.min(minY, p.y);
      }
      return y0 - minY;
    };
    expect(apex(3)).toBeLessThan(apex(60) * 0.6);
  });

  it('jump distance at full speed is about 7.5 tiles', () => {
    const g = flat();
    let p = settle(stand(5 * TS, 10), g);
    for (let i = 0; i < 40; i++) p = step(p, { dir: 1, jump: false }, g); // reach full speed
    expect(p.vx).toBe(T.maxRun);
    const x0 = p.x;
    let airborne = true, jumped = false;
    let i = 0;
    while (airborne && i < 120) {
      p = step(p, { dir: 1, jump: !jumped || i < 60 }, g);
      jumped = true;
      i++;
      if (p.grounded) airborne = false;
    }
    const dist = (p.x - x0) / TS;
    expect(dist).toBeGreaterThan(7.0);
    expect(dist).toBeLessThan(8.0);
  });

  it('a six-tile hole is cleared at full speed with frames to spare on both sides', () => {
    const g = flat(80, 10, 16);
    for (let c = 30; c < 36; c++) for (let r = 10; r < 16; r++) g.set(c, r, Tile.EMPTY);
    // run at full speed, jump `k` frames after the hitbox's left edge passes... sweep the jump frame
    const results: boolean[] = [];
    for (let jf = 80; jf < 140; jf++) {
      let p = settle(stand(10 * TS, 10), g);
      let ok = true;
      for (let f = 0; f < 200; f++) {
        // hold jump continuously from frame jf for 60 frames
        const jump = f >= jf && f < jf + 60;
        p = step(p, { dir: 1, jump }, g);
        if (p.y > 12 * TS) { ok = false; break; }
        if (p.x > 40 * TS) break;
      }
      results.push(ok && p.x > 40 * TS);
    }
    // count the contiguous run of success frames containing the middle of the window
    const first = results.indexOf(true);
    let n = 0;
    while (results[first + n]) n++;
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it('wall-slide caps fall speed while holding toward the wall', () => {
    const g = flat();
    for (let r = 0; r < 10; r++) g.set(20, r, Tile.SOLID);
    let p: PlayerState = { ...makePlayer(20 * TS - T.playerW, 2 * TS), vy: 0 };
    for (let i = 0; i < 40; i++) p = step(p, { dir: 1, jump: false }, g);
    expect(p.wallDir).toBe(1);
    expect(p.vy).toBeLessThanOrEqual(T.wallSlideCap + 1e-9);
    expect(p.vy).toBeGreaterThan(0);
  });

  // Climbing controller: always hold toward the wall; press jump whenever grounded or touching it.
  function climb(wallRows: number, frames: number, eager = false) {
    const floorRow = 40;
    const g = flat(80, floorRow, 44);
    for (let r = floorRow - wallRows; r < floorRow; r++) g.set(20, r, Tile.SOLID);
    let p: PlayerState = stand(20 * TS - T.playerW - 2, floorRow);
    let held: boolean = false;
    let wallJumps = 0;
    const apexes: number[] = [];
    let maxH = 0;
    let cleared = -1;
    for (let f = 0; f < frames; f++) {
      // ground jump from the floor; wall jump once the hop has peaked (vy >= 0); otherwise hold the jump
      const canGround = p.grounded;
      const canWall: boolean = p.wallDir === 1 && (eager ? !p.grounded && p.wallLock === 0 && held === false : p.vy >= 0);
      const jump: boolean = canGround || canWall ? !held : p.vy < 0;
      const q = step(p, { dir: 1, jump }, g);
      if (q.wallLock === T.wallLock && p.wallDir !== 0 && !p.grounded) {
        wallJumps++;
        apexes.push(maxH);
        maxH = 0;
      }
      held = jump;
      p = q;
      maxH = Math.max(maxH, (floorRow * TS - T.playerH - p.y) / TS);
      if (p.x > 20 * TS + TS && p.grounded && cleared < 0) { cleared = wallJumps; break; }
    }
    apexes.push(maxH);
    const hopApexGain = apexes.slice(1).map((a, i) => a - apexes[i]!);
    return { wallJumps, hopApexGain, cleared };
  }

  it('repeated wall jumps climb a wall, each hop gaining 2 to 3 tiles', () => {
    const r = climb(30, 260, true);
    expect(r.wallJumps).toBeGreaterThanOrEqual(4);
    expect(r.hopApexGain.length).toBeGreaterThanOrEqual(6);
    for (const gain of r.hopApexGain.slice(0, 6)) {
      expect(gain).toBeGreaterThan(2.0);
      expect(gain).toBeLessThan(3.2);
    }
  });

  it('a six-tile wall is cleared with one jump and at most two wall jumps', () => {
    const r = climb(6, 400);
    expect(r.cleared).toBeGreaterThanOrEqual(0);
    expect(r.cleared).toBeLessThanOrEqual(2);
  });

  it('mud halves the maximum run speed', () => {
    const g = flat();
    for (let c = 20; c < 40; c++) g.set(c, 10, Tile.MUD);
    let p = settle(stand(25 * TS, 10), g);
    for (let i = 0; i < 30; i++) p = step(p, { dir: 1, jump: false }, g);
    expect(p.vx).toBeCloseTo(T.maxRun * T.mudFactor, 6);
  });

  it('a bumper knocks the player back and has a cooldown', () => {
    const g = flat();
    g.set(25, 9, Tile.BUMPER);
    let p = settle(stand(15 * TS, 10), g);
    let hit = false;
    for (let i = 0; i < 80; i++) {
      p = step(p, { dir: 1, jump: false }, g);
      if (p.bumperCooldown > 0) { hit = true; expect(p.vy).toBeLessThan(0); break; }
    }
    expect(hit).toBe(true);
  });

  it('a one-way ledge can be jumped up through and landed on', () => {
    const g = flat(80, 14, 18);
    for (let c = 20; c < 26; c++) g.set(c, 12, Tile.ONEWAY); // 2 tiles above floor
    let p = settle(stand(22 * TS, 14), g);
    for (let i = 0; i < 70; i++) p = step(p, { dir: 0, jump: i < 30 }, g);
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(12 * TS - T.playerH, 6);
  });
});
