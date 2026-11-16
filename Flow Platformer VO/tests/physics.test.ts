import { describe, it, expect } from 'vitest';
import { T } from '../src/tuning';
import { step, playerOnFloor } from '../src/sim/physics';
import { TextGrid } from '../src/sim/grid';
import type { Input, PlayerState, Grid } from '../src/sim/types';
import { testLevel } from '../src/sim/testLevel';

const TS = T.tile;
const open = new TextGrid([...Array(10).fill('.'.repeat(80)), '#'.repeat(80)]);

/** Simple scripted player: run right, jump at obstacles, press jump on wall contact. */
function climbPolicy() {
  let prev = false;
  return (s: PlayerState, wantJump: boolean): Input => {
    const press = (s.wallDir !== 0 || wantJump) && !prev;
    const jump = press || (prev && s.vy < 0);
    prev = jump;
    return { dir: 1, jump };
  };
}

describe('physics', () => {
  it('jump apex is about 3.75 tiles', () => {
    let s = playerOnFloor(10, 10);
    const y0 = s.y; let minY = y0;
    for (let i = 0; i < 80; i++) { s = step(s, { dir: 0, jump: true }, open); minY = Math.min(minY, s.y); }
    const apex = (y0 - minY) / TS;
    expect(apex).toBeGreaterThan(3.4);
    expect(apex).toBeLessThan(3.9);
  });

  it('full-speed jump covers about 7.5 tiles', () => {
    let s = playerOnFloor(5, 10, T.maxRun);
    const x0 = s.x;
    s = step(s, { dir: 1, jump: true }, open);
    while (!s.grounded) s = step(s, { dir: 1, jump: true }, open);
    const d = (s.x - x0) / TS;
    expect(d).toBeGreaterThan(7);
    expect(d).toBeLessThan(7.8);
  });

  it('a short tap gives a lower jump than a held jump', () => {
    const apex = (hold: number) => {
      let s = playerOnFloor(10, 10); const y0 = s.y; let m = y0;
      for (let i = 0; i < 80; i++) { s = step(s, { dir: 0, jump: i < hold }, open); m = Math.min(m, s.y); }
      return y0 - m;
    };
    expect(apex(3)).toBeLessThan(apex(40) * 0.6);
  });

  it('each wall hop on a single wall gains two to three tiles', () => {
    const wall = new TextGrid(Array.from({ length: 40 }, (_, i) => (i === 39 ? '#'.repeat(20) : '..........#.........')));
    let s = playerOnFloor(9.6, 39);
    const pol = climbPolicy();
    const ys: number[] = [];
    for (let f = 0; f < 900 && ys.length < 7; f++) {
      const before = s;
      s = step(s, pol(s, f === 0), wall);
      if (before.wallDir !== 0 && s.wallLock === T.wallLock - 1) ys.push(before.y);
    }
    expect(ys.length).toBeGreaterThanOrEqual(6);
    for (let k = 2; k < ys.length; k++) {
      const gain = (ys[k - 1] - ys[k]) / TS;
      expect(gain).toBeGreaterThanOrEqual(2);
      expect(gain).toBeLessThanOrEqual(3);
    }
  });

  it('a six-tile wall is cleared with one jump and at most two wall jumps', () => {
    const rows = Array.from({ length: 11 }, () => '.'.repeat(40).split(''));
    for (let x = 0; x < 40; x++) rows[10][x] = '#';
    for (let y = 4; y < 10; y++) rows[y][20] = '#';
    const g = new TextGrid(rows.map((r) => r.join('')));
    let s = playerOnFloor(14, 10, T.maxRun);
    const pol = climbPolicy();
    let wallJumps = 0, jumped = false;
    for (let f = 0; f < 300; f++) {
      const nearWall = s.grounded && s.x + T.playerW > 19 * TS - 8;
      const before = s;
      s = step(s, pol(s, nearWall && !jumped), g);
      if (before.grounded && !s.grounded && s.vy < 0) jumped = true;
      if (before.wallDir !== 0 && s.wallLock === T.wallLock - 1) wallJumps++;
      if (s.grounded && s.x > 21 * TS) break;
    }
    expect(s.x).toBeGreaterThan(21 * TS);
    expect(wallJumps).toBeLessThanOrEqual(2);
  });

  it('a six-tile hole is cleared at full speed with frames to spare', () => {
    const rows = Array.from({ length: 13 }, () => '#'.repeat(60).split(''));
    for (let y = 0; y < 10; y++) rows[y] = '.'.repeat(60).split('');
    for (let x = 30; x < 36; x++) for (let y = 10; y < 13; y++) rows[y][x] = '.';
    const g = new TextGrid(rows.map((r) => r.join('')));
    const ok: number[] = [];
    for (let jf = 0; jf < 80; jf++) {
      let s = playerOnFloor(20, 10, T.maxRun);
      for (let f = 0; f < 200; f++) s = step(s, { dir: 1, jump: f >= jf && f < jf + 40 }, g);
      if (s.y < 10 * TS && s.x > 36 * TS) ok.push(jf);
    }
    // the successful take-off frames form a window; a few frames of slack on each side
    expect(ok.length).toBeGreaterThanOrEqual(8);
  });

  it('two runs with the same inputs give identical states', () => {
    const g: Grid = testLevel();
    const inputs: Input[] = Array.from({ length: 600 }, (_, i) => ({ dir: (i % 97 < 80 ? 1 : -1) as 1 | -1, jump: i % 23 < 9 }));
    const run = () => { let s = playerOnFloor(2, 9); for (const i of inputs) s = step(s, i, g); return s; };
    expect(run()).toEqual(run());
  });

  it('step never mutates its input', () => {
    const s = playerOnFloor(5, 10, 3);
    const copy = { ...s };
    step(s, { dir: 1, jump: true }, open);
    expect(s).toEqual(copy);
  });

  it('mud halves top speed and the bumper knocks back', () => {
    const mud = new TextGrid([...Array(10).fill('.'.repeat(40)), 'm'.repeat(40)]);
    let s = playerOnFloor(5, 10);
    for (let i = 0; i < 60; i++) s = step(s, { dir: 1, jump: false }, mud);
    expect(s.vx).toBeCloseTo(T.maxRun * T.mudFactor);
    const bump = new TextGrid([...Array(9).fill('.'.repeat(40)), '.'.repeat(20) + 'b' + '.'.repeat(19), '#'.repeat(40)]);
    s = playerOnFloor(15, 10, T.maxRun);
    let hit = false;
    for (let i = 0; i < 60; i++) { s = step(s, { dir: 1, jump: false }, bump); if (s.bumperCooldown > 0) { hit = true; break; } }
    expect(hit).toBe(true);
    expect(s.vx).toBe(T.bumperVx);
  });

  it('one-way tiles are passed from below and stood on from above', () => {
    const g = new TextGrid([...Array(7).fill('.'.repeat(20)), '.'.repeat(5) + '=====' + '.'.repeat(10), '.'.repeat(20), '.'.repeat(20), '#'.repeat(20)]);
    let s = playerOnFloor(7.5, 10);
    for (let i = 0; i < 90; i++) s = step(s, { dir: 0, jump: true }, g);
    expect(s.grounded).toBe(true);
    expect(s.y + T.playerH).toBe(7 * TS);
  });
});

import { assembleSegment, World, laneFloor } from '../src/game/world';
import { flatChunk } from '../src/gen/generator';
import { Tile as TT } from '../src/sim/types';

describe('lane-2 pits', () => {
  it('a plain jump while holding right climbs out of a pit', () => {
    for (const width of [2, 4, 6]) {
      const low = flatChunk();
      for (let x = 15; x < 15 + width; x++) low.tiles[8 * 40 + x] = TT.EMPTY;
      const w = new World();
      w.add([flatChunk(), flatChunk(), low]);
      w.add([flatChunk(), flatChunk(), flatChunk()]);
      expect(assembleSegment([flatChunk(), flatChunk(), low]).length).toBe(40 * 31);
      // stand at the bottom of the pit against its right wall
      let s = playerOnFloor(15 + width - 0.4, 29);
      expect(s.y + T.playerH).toBe(29 * TS);
      expect(w.get(16, 29)).toBe(TT.SOLID);
      expect(w.get(16, 28)).toBe(TT.EMPTY);
      s = step(s, { dir: 0, jump: false }, w);
      expect(s.grounded).toBe(true);
      for (let f = 0; f < 90; f++) s = step(s, { dir: 1, jump: f < 40 }, w);
      expect(s.y + T.playerH).toBe(laneFloor(2) * TS);
      expect(s.grounded).toBe(true);
    }
  });
});
