import { describe, expect, it } from 'vitest';
import { solveChunk } from '../src/gen/bot';
import { flatChunk, generateChunk } from '../src/gen/generator';
import { manoeuvres, scoreChunk } from '../src/gen/scorer';
import { Tile, type Chunk } from '../src/sim/types';

function scored(c: Chunk) {
  const run = solveChunk(c);
  return run ? { run, score: scoreChunk(c, run) } : null;
}
function holeChunk(w: number): Chunk {
  const c = flatChunk();
  c.seed = 1000 + w;
  for (let k = 18; k < 18 + w; k++) c.tiles[8 * 40 + k] = Tile.EMPTY;
  return c;
}

describe('scorer', () => {
  it('scores a flat chunk below 0.02', () => {
    const r = scored(flatChunk())!;
    expect(r.score.D).toBeLessThan(0.02);
    expect(r.score.flow).toBeCloseTo(1, 5);
  });

  it('rises with hole width from 2 to 6 (trend, not strictly per width)', () => {
    const ds = [2, 3, 4, 5, 6].map((w) => scored(holeChunk(w))!.score.D);
    console.log('D by hole width 2..6:', ds.map((d) => d.toFixed(3)).join(' '));
    // The bot jumps at the last coyote frame and its steps are 4 frames long, so single widths can dip
    // by a few hundredths (known bias, plan section 6). The trend must still be clearly upward.
    for (let i = 1; i < 4; i++) expect(ds[i]!).toBeGreaterThanOrEqual(ds[i - 1]! - 0.03);
    expect(Math.max(ds[3]!, ds[4]!)).toBeGreaterThan(ds[0]! + 0.05);
    expect(ds[4]!).toBeGreaterThan(ds[0]!);
  });

  it('scores the same chunk the same way every time', () => {
    const c = generateChunk(77, 0.7);
    const a = scored(c)!.score, b = scored(c)!.score;
    expect(a).toEqual(b);
  });

  it('splits a hole run into run-up and jump manoeuvres', () => {
    const run = solveChunk(holeChunk(4))!;
    const ms = manoeuvres(run);
    expect(ms.length).toBeGreaterThanOrEqual(2);
    expect(ms[0]!.a).toBe(0);
    expect(ms[ms.length - 1]!.b).toBe(run.frames);
    for (let i = 1; i < ms.length; i++) expect(ms[i]!.a).toBe(ms[i - 1]!.b);
  });

  it('over 200 generated chunks, D correlates with intensity and spreads out', () => {
    const xs: number[] = [], ys: number[] = [];
    const t0 = Date.now();
    for (let s = 0; s < 200; s++) {
      const intensity = ((s * 37) % 100) / 100;
      const c = generateChunk(5000 + s, intensity);
      const r = scored(c);
      if (r) { xs.push(intensity); ys.push(r.score.D); }
    }
    const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i]! - my); sxx += (x - mx) ** 2; syy += (ys[i]! - my) ** 2; });
    const corr = sxy / Math.sqrt(sxx * syy);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    console.log(`n=${ys.length} corr=${corr.toFixed(3)} D range ${lo.toFixed(3)}..${hi.toFixed(3)} ms/chunk=${((Date.now() - t0) / 200).toFixed(0)}`);
    expect(corr).toBeGreaterThan(0);
    expect(lo).toBeLessThanOrEqual(0.05);
    expect(hi).toBeGreaterThanOrEqual(0.7);
  });
});
