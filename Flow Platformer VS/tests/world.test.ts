import { describe, expect, it } from 'vitest';
import { T } from '../src/tuning';
import { assemblyOk, flatChunk, generateChunk, holeSpans } from '../src/gen/generator';
import { fixedSegment } from '../src/game/director';
import { laneFloorRow, World } from '../src/game/world';
import { makeStanding, step } from '../src/sim/physics';
import { Tile, type Chunk } from '../src/sim/types';

const TS = T.tile;

describe('generator', () => {
  it('is deterministic per seed', () => {
    const a = generateChunk(123, 0.6), b = generateChunk(123, 0.6);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
  });
  it('keeps the first and last four columns flat and clear', () => {
    for (let s = 0; s < 300; s++) {
      const c = generateChunk(s, (s % 11) / 10);
      for (const col of [0, 1, 2, 3, 36, 37, 38, 39]) {
        for (let r = 0; r < 8; r++) expect(c.tiles[r * 40 + col]).toBe(Tile.EMPTY);
        expect(c.tiles[8 * 40 + col]).toBe(Tile.SOLID);
      }
    }
  });
  it('higher intensity gives bigger obstacles on average', () => {
    const area = (i: number) => {
      let sum = 0;
      for (let s = 0; s < 200; s++) {
        const c = generateChunk(s, i);
        for (const t of c.tiles) if (t !== Tile.SOLID) sum += 0;
        sum += holeSpans(c).reduce((a, [x, y]) => a + (y - x + 1), 0);
        for (let k = 0; k < 8 * 40; k++) if (c.tiles[k] === Tile.SOLID) sum += 1;
      }
      return sum;
    };
    expect(area(0.9)).toBeGreaterThan(area(0.1));
  });
  it('assembly rule rejects overlapping holes within drift range', () => {
    const mk = (a: number, b: number): Chunk => {
      const c = flatChunk();
      for (let k = a; k <= b; k++) c.tiles[8 * 40 + k] = Tile.EMPTY;
      return c;
    };
    expect(assemblyOk(mk(10, 12), mk(14, 16))).toBe(false); // within 6 past the last column
    expect(assemblyOk(mk(10, 12), mk(20, 22))).toBe(true);
    expect(assemblyOk(mk(10, 12), mk(2, 3))).toBe(true);
  });
});

describe('world', () => {
  it('stacks lanes, gates and pits correctly', () => {
    const w = new World();
    w.addSegment([flatChunk(), flatChunk(), flatChunk()]);
    expect(w.get(10, laneFloorRow(0))).toBe(Tile.SOLID);
    expect(w.get(1, laneFloorRow(0))).toBe(Tile.ONEWAY); // gate into lane 0
    expect(w.get(1, laneFloorRow(1))).toBe(Tile.ONEWAY); // gate into lane 1
    expect(w.get(3, laneFloorRow(0) + 3)).toBe(Tile.SOLID); // hanging wall
    expect(w.get(3, laneFloorRow(0) + 6)).toBe(Tile.EMPTY);
    expect(w.get(5, -1)).toBe(Tile.SOLID);
    expect(w.get(5, 30)).toBe(Tile.SOLID);
  });

  it('a hole in lane 0 drops the player into lane 1; a lane 2 hole opens a pit', () => {
    const c0 = flatChunk();
    for (let k = 10; k <= 12; k++) c0.tiles[8 * 40 + k] = Tile.EMPTY;
    const c2 = flatChunk();
    for (let k = 10; k <= 12; k++) c2.tiles[8 * 40 + k] = Tile.EMPTY;
    const w = new World();
    w.addSegment([c0, flatChunk(), c2]);
    expect(w.get(11, 27)).toBe(Tile.EMPTY);
    expect(w.get(15, 27)).toBe(Tile.SOLID);

    let p = makeStanding(6 * TS, laneFloorRow(0) * TS);
    for (let i = 0; i < 120; i++) p = step(p, { dir: 1, jump: false }, w);
    expect(Math.floor((p.y + T.playerH / 2) / TS)).toBeGreaterThan(8);
    expect(Math.floor((p.y + T.playerH / 2) / TS)).toBeLessThan(18);

    let q = makeStanding(6 * TS, laneFloorRow(2) * TS);
    for (let i = 0; i < 60; i++) q = step(q, { dir: 1, jump: false }, w);
    expect(q.y + T.playerH).toBeLessThanOrEqual(30 * TS + 1e-6); // stopped by the pit floor, row 30
    expect(Math.floor((q.y + T.playerH / 2) / TS)).toBeGreaterThanOrEqual(27);
  });

  it('keeps memory flat: segments behind the player are discarded', () => {
    const w = new World();
    for (let i = 0; i < 500; i++) {
      w.addSegment(fixedSegment(7, i));
      w.discardBefore(i - T.runtime.keepBehindSegments);
    }
    expect(w.segments.size).toBeLessThanOrEqual(T.runtime.keepBehindSegments + 2);
  });

  it('fixed segments keep the assembly rule or fall back to flat', () => {
    for (let i = 1; i < 60; i++) {
      const [c0, c1, c2] = fixedSegment(99, i);
      expect(assemblyOk(c0, c1)).toBe(true);
      expect(assemblyOk(c1, c2)).toBe(true);
    }
  });
});
