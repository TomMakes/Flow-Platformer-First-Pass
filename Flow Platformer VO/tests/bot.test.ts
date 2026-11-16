import { describe, it, expect } from 'vitest';
import { T } from '../src/tuning';
import { solveChunk, beamSearch } from '../src/gen/bot';
import { Field } from '../src/gen/field';
import { flatTiles } from '../src/gen/generator';
import { playerOnFloor } from '../src/sim/physics';
import { Tile } from '../src/sim/types';
import { testLevel, TEST_FLOOR_ROW, TEST_GOAL_COL } from '../src/sim/testLevel';

const W = T.chunkW;

describe('bot', () => {
  it('solves the milestone-1 test level, including the six-tile wall', () => {
    const g = testLevel();
    const field = new Field(g, g.w, g.h, [TEST_GOAL_COL]);
    const run = beamSearch(g, {
      start: playerOnFloor(2, TEST_FLOOR_ROW, T.maxRun), field,
      isGoal: (s) => s.grounded && s.x + T.playerW / 2 >= TEST_GOAL_COL * T.tile,
      isDead: (s) => s.y >= (TEST_FLOOR_ROW + 1) * T.tile,
      stepLimit: 250,
    });
    expect(run).not.toBeNull();
    // it passed the wall's columns
    const pastWall = run!.trace.findIndex((s) => s.x > 24 * T.tile);
    expect(pastWall).toBeGreaterThan(0);
  });

  it('climbs a six-tile wall inside a chunk with wall jumps', () => {
    const t = flatTiles();
    for (let y = 2; y < 8; y++) t[y * W + 20] = Tile.SOLID;
    const run = solveChunk({ tiles: t });
    expect(run).not.toBeNull();
    const wallJumps = run!.trace.filter((s, i) => i > 0 && s.wallLock === T.wallLock - 1 && run!.trace[i - 1].wallLock === 0).length;
    expect(wallJumps).toBeGreaterThanOrEqual(1);
  });

  it('returns null for a ten-tile hole', () => {
    const t = flatTiles();
    for (let x = 14; x < 24; x++) t[8 * W + x] = Tile.EMPTY;
    expect(solveChunk({ tiles: t })).toBeNull();
  });

  it('solves a flat chunk in about 196 frames', () => {
    const run = solveChunk({ tiles: flatTiles() });
    expect(run).not.toBeNull();
    expect(Math.abs(run!.frames - 196)).toBeLessThanOrEqual(4);
  });
});
