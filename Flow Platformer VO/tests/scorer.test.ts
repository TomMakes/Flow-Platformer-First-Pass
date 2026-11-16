import { describe, it, expect } from 'vitest';
import { solveChunk } from '../src/gen/bot';
import { scoreChunk } from '../src/gen/scorer';
import { generateChunk, flatTiles } from '../src/gen/generator';
import { Tile } from '../src/sim/types';

const holeChunk = (w: number, seed: number) => {
  const t = flatTiles();
  for (let x = 15; x < 15 + w; x++) t[8 * 40 + x] = Tile.EMPTY;
  return { seed, tiles: t };
};
const D = (c: { seed: number; tiles: Uint8Array }) => scoreChunk(c, solveChunk(c)!).D;

describe('scorer', () => {
  it('a flat chunk scores D below 0.02', () => {
    expect(D({ seed: 7, tiles: flatTiles() })).toBeLessThan(0.02);
  });

  it('D rises with hole width from 2 to 6', () => {
    const mean = (w: number) => [1, 2, 3, 4, 5].reduce((a, s) => a + D(holeChunk(w, s)), 0) / 5;
    const m = [2, 3, 4, 5, 6].map(mean);
    for (let k = 1; k < m.length; k++) expect(m[k]).toBeGreaterThanOrEqual(m[k - 1]);
    expect(m[2]).toBeGreaterThan(m[0] + 0.03);
    expect(m[4]).toBeGreaterThan(m[2] + 0.1);
  });

  it('the same chunk scores the same D every run', () => {
    const c = generateChunk(4242, 0.6);
    const r1 = solveChunk(c), r2 = solveChunk(c);
    expect(r1).not.toBeNull();
    expect(scoreChunk(c, r1!)).toEqual(scoreChunk(c, r2!));
  });

  it('over 200 chunks, D correlates with intensity and spreads from 0.05 to 0.7', { timeout: 60000 }, () => {
    const pts: [number, number][] = [];
    for (let k = 0; k < 200; k++) {
      const I = k / 199;
      const c = generateChunk(9000 + k, I);
      const run = solveChunk(c);
      if (run) pts.push([I, scoreChunk(c, run).D]);
    }
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    const cov = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
    const vx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0), vy = pts.reduce((a, p) => a + (p[1] - my) ** 2, 0);
    expect(cov / Math.sqrt(vx * vy)).toBeGreaterThan(0.3);
    const ds = pts.map((p) => p[1]);
    expect(Math.min(...ds)).toBeLessThanOrEqual(0.05);
    expect(Math.max(...ds)).toBeGreaterThanOrEqual(0.7);
  });
});
