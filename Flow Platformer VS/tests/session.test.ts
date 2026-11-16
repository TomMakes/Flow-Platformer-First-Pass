import { describe, expect, it } from 'vitest';
import { T } from '../src/tuning';
import { solveChunk } from '../src/gen/bot';
import { flatChunk } from '../src/gen/generator';
import { ChunkProducer } from '../src/gen/pipeline';
import { Director } from '../src/game/director';
import { Tracker } from '../src/game/tracker';
import { World } from '../src/game/world';

/**
 * Headless stand-in for a play session: the "worker" produces a few chunks between segments, the
 * director assembles segments from the bank, and the player is the bot replaying its clean run
 * (a perfect player) or falling at the start of every chunk (a struggling player).
 */
function session(mode: 'clean' | 'fall' | 'capped', segments: number, chunksPerSegment: number, cap = 0.55) {
  const producer = new ChunkProducer(2024);
  const director = new Director();
  const tracker = new Tracker();
  const world = new World();
  world.addSegment([flatChunk(), flatChunk(), flatChunk()]);
  const sync = () => producer.setState(tracker.s, director.binCounts());
  const pump = (n: number) => {
    for (let i = 0; i < n; i++) {
      const c = producer.produce();
      if (c) director.add(c, tracker.s);
    }
    sync();
  };
  let guard = 0;
  while (!director.ready(tracker.s) && guard++ < 400) pump(1);
  expect(director.ready(tracker.s)).toBe(true);
  const startupChunks = guard;
  director.misses = 0;

  const sHistory: number[] = [tracker.s];
  const laneD: Array<[number, number, number]> = [];
  for (let n = 0; n < segments; n++) {
    const pick = director.pick(tracker.s);

    const seg = world.addSegment(pick.chunks);
    laneD.push([pick.chunks[0].score.D, pick.chunks[1].score.D, pick.chunks[2].score.D]);
    // play lane 0 (hardest) like a confident player; the capped player falls on anything above `cap`
    const lane = 0;
    const chunk = seg.chunks[lane]!;
    if (chunk.score.T0 > 0) {
      const run = solveChunk(chunk)!;
      const ox = seg.index * T.segW * T.tile, oy = lane * T.chunkH * T.tile;
      const place = (s: { x: number; y: number }) => ({ x: s.x + ox, y: s.y + oy });
      if (mode === 'clean' || (mode === 'capped' && chunk.score.D <= cap)) {
        for (const st of run.trace) tracker.update({ ...st, ...place(st) }, world);
      } else {
        for (let i = 0; i < 12; i++) tracker.update({ ...run.trace[i]!, ...place(run.trace[i]!) }, world);
        const st = run.trace[12]!;
        tracker.update({ ...st, grounded: false, x: st.x + ox, y: st.y + oy + T.chunkH * T.tile }, world);
      }
    }
    sHistory.push(tracker.s);
    sync();
    pump(chunksPerSegment);
    world.discardBefore(seg.index - T.runtime.keepBehindSegments);
  }
  return { sHistory, misses: director.misses, startupChunks, laneD, producer, world };
}

describe('headless session', () => {
  it('a clean player pushes s above 0.5 within ten chunks (a perfect bot then saturates s near 1)', () => {
    const r = session('clean', 12, 30);
    console.log('clean s:', r.sHistory.map((x) => x.toFixed(2)).join(' '), '| misses', r.misses, '| startup chunks', r.startupChunks,
      `| solved ${r.producer.solved} discarded ${r.producer.discarded}`);
    expect(Math.max(...r.sHistory.slice(0, 11))).toBeGreaterThan(0.5);
    expect(r.world.segments.size).toBeLessThanOrEqual(T.runtime.keepBehindSegments + 3);
  });

  it('a player of middling skill settles mid-range with no bank misses and lane 0 > lane 1 > lane 2 in 9 of 10 segments', () => {
    const r = session('capped', 12, 30);
    console.log('capped s:', r.sHistory.map((x) => x.toFixed(2)).join(' '), '| misses', r.misses);
    expect(r.misses).toBe(0);
    expect(r.sHistory[r.sHistory.length - 1]!).toBeLessThan(0.95);
    const ordered = r.laneD.filter(([a, b, c]) => a > b && b > c).length;
    expect(ordered / r.laneD.length).toBeGreaterThanOrEqual(0.9);

  });

  it('a struggling player sees s fall within five chunks', () => {
    const r = session('fall', 6, 30);
    console.log('struggling s:', r.sHistory.map((x) => x.toFixed(2)).join(' '), '| misses', r.misses);
    expect(r.sHistory[5]!).toBeLessThan(r.sHistory[0]!);
    expect(r.misses).toBe(0);
  });
});
