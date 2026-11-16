import { describe, expect, it } from 'vitest';
import { T } from '../src/tuning';
import { solveChunk } from '../src/gen/bot';
import { flatChunk } from '../src/gen/generator';
import { ChunkProducer, binOf } from '../src/gen/pipeline';
import { Director } from '../src/game/director';
import { expectedOutcome, Tracker, updateSkill } from '../src/game/tracker';
import { World } from '../src/game/world';
import { assemblyOk } from '../src/gen/generator';
import type { Chunk, PlayerState } from '../src/sim/types';

function synthetic(D: number, seed = 1): Chunk {
  const c = flatChunk();
  c.seed = seed;
  c.score = { T0: 196, pFall: D, expectedFrames: 196, flow: 1, D };
  return c;
}

describe('skill update', () => {
  it('rises sharply on a clean run well above s and barely on one well below', () => {
    const up = updateSkill(0.25, 0.4, 1, T.tracker.kEarly) - 0.25;
    const flat = updateSkill(0.6, 0.1, 1, T.tracker.kEarly) - 0.6;
    expect(up).toBeGreaterThan(0.15);
    expect(flat).toBeLessThan(0.05);
  });
  it('clean lane 0 runs push s above 0.5 within a few chunks', () => {
    let s: number = T.tracker.startS;
    for (let i = 0; i < 5; i++) s = updateSkill(s, s + T.tracker.laneOffset, 1, i < 4 ? T.tracker.kEarly : T.tracker.kLate);
    expect(s).toBeGreaterThan(0.5);
  });
  it('falling into every hole pulls s down within five chunks', () => {
    let s = 0.6;
    for (let i = 0; i < 5; i++) s = updateSkill(s, s, 0, i < 4 ? T.tracker.kEarly : T.tracker.kLate);
    expect(s).toBeLessThan(0.4);
    expect(expectedOutcome(0.5, 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe('tracker', () => {
  const prod = new ChunkProducer(4242);
  const chunks: Chunk[] = [];
  for (let i = 0; chunks.length < 3 && i < 60; i++) {
    const c = prod.produce();
    if (c) chunks.push(c);
  }
  const world = new World();
  world.addSegment([flatChunk(), flatChunk(), flatChunk()]);
  world.addSegment([chunks[0]!, chunks[1]!, chunks[2]!]);

  const place = (s: PlayerState, lane: number): PlayerState => ({ ...s, x: s.x + T.segW * T.tile, y: s.y + lane * T.chunkH * T.tile });

  it('scores a clean completion using the bot trace as the player', () => {
    const lane = 1;
    const chunk = chunks[lane]!;
    const run = solveChunk(chunk)!;
    const tr = new Tracker();
    let outcome = null;
    for (const st of run.trace) outcome = tr.update(place(st, lane), world) ?? outcome;
    expect(outcome).not.toBeNull();
    expect(outcome!.kind).toBe('clean');
    expect(outcome!.ratio).toBeGreaterThan(0.95);
    expect(tr.scored).toBe(1);
  });

  it('scores a fall the moment the player leaves the lane downward', () => {
    const lane = 0;
    const chunk = chunks[lane]!;
    const run = solveChunk(chunk)!;
    const tr = new Tracker();
    const s0 = tr.s;
    for (let i = 0; i < 20; i++) tr.update(place(run.trace[i]!, lane), world);
    const fallen = place({ ...run.trace[20]!, grounded: false }, lane + 1);
    const o = tr.update(fallen, world);
    expect(o?.kind).toBe('fell');
    expect(tr.s).toBeLessThan(s0);
  });

  it('does not score a player who arrives mid-chunk', () => {
    const run = solveChunk(chunks[1]!)!;
    const tr = new Tracker();
    const mid = run.trace.find((s) => s.grounded && s.x > 12 * T.tile)!;
    expect(tr.update(place(mid, 1), world)).toBeNull();
    expect(tr.active).toBeNull();
  });
});

describe('director', () => {
  it('orders lanes by difficulty, honours the assembly rule, and removes chosen chunks', () => {
    const d = new Director();
    for (let i = 0; i < 60; i++) d.add(synthetic(i / 60, i + 1), 0.5);
    const before = d.bank.length;
    const pick = d.pick(0.5);
    const [c0, c1, c2] = pick.chunks;
    expect(c0.score.D).toBeGreaterThan(c1.score.D);
    expect(c1.score.D).toBeGreaterThan(c2.score.D);
    expect(assemblyOk(c0, c1) && assemblyOk(c1, c2)).toBe(true);
    expect(Math.abs(c1.score.D - 0.5)).toBeLessThan(0.05);
    expect(d.bank.length).toBe(before - 3);
    expect(pick.misses).toBe(0);
  });

  it('counts a bank miss and uses a flat chunk when nothing is usable', () => {
    const d = new Director();
    const pick = d.pick(0.5);
    expect(pick.misses).toBe(3);
    expect(d.misses).toBe(3);
    expect(pick.chunks.every((c) => c.score.T0 === 0)).toBe(true);
  });

  it('evicts the chunk farthest from s when the bank is full', () => {
    const d = new Director();
    for (let i = 0; i < T.runtime.bankMax; i++) d.add(synthetic(0.5, i + 1), 0.5);
    d.add(synthetic(0.99, 999), 0.5);
    expect(d.bank.length).toBe(T.runtime.bankMax);
    expect(d.bank.some((c) => c.seed === 999)).toBe(false);
  });

  it('startup readiness needs 12 chunks and 3 near each lane target', () => {
    const d = new Director();
    const s = 0.25;
    for (const t of Director.targets(s)) for (let i = 0; i < 4; i++) d.add(synthetic(t, Math.floor(t * 1000) + i), s);
    expect(d.ready(s)).toBe(true);
    const e = new Director();
    for (let i = 0; i < 20; i++) e.add(synthetic(0.9, i + 1), s);
    expect(e.ready(s)).toBe(false);
  });
});

describe('chunk producer (the worker brain)', () => {
  it('targets the emptiest bin near s and records scored chunks', () => {
    const p = new ChunkProducer(7);
    p.setState(0.5, [5, 5, 5, 5, 5, 0, 5, 5, 5, 5]);
    expect(p.pickBin()).toBe(5);
    p.setState(0.5, [5, 5, 5, 0, 5, 5, 5, 5, 5, 5]);
    expect(p.pickBin()).toBe(3);
    p.setState(0.05, new Array(10).fill(0));
    expect(Math.abs((p.pickBin() + 0.5) / 10 - 0.05)).toBeLessThanOrEqual(0.3);
  });

  it('produces only solved, scored chunks, deterministically per seed', () => {
    const run = (seed: number) => {
      const p = new ChunkProducer(seed);
      const out: Chunk[] = [];
      for (let i = 0; i < 12; i++) {
        const c = p.produce();
        if (c) out.push(c);
      }
      return { out, p };
    };
    const a = run(11), b = run(11);
    expect(a.out.length).toBeGreaterThan(0);
    expect(a.out.map((c) => c.score.D)).toEqual(b.out.map((c) => c.score.D));
    for (const c of a.out) {
      expect(c.score.T0).toBeGreaterThan(0);
      expect(c.ghost).toBeDefined();
      expect(binOf(c.score.D)).toBeGreaterThanOrEqual(0);
    }
    expect(a.p.solved + a.p.discarded).toBe(12);
  });
});

const sources = import.meta.glob('../src/{sim,gen}/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const strip = (t: string) => t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('determinism rules', () => {
  it('sim/ and gen/ avoid DOM, Math.random, Date and performance.now (worker.ts excepted for timing)', () => {
    const banned = /Math\.random|\bDate\b|performance\.now|\bdocument\b|\bwindow\b/;
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(8);
    for (const [path, raw] of files) {
      const text = strip(raw);
      if (path.endsWith('worker.ts')) expect(text).not.toMatch(/Math\.random|\bDate\b|\bdocument\b|\bwindow\b/);
      else expect(text, path).not.toMatch(banned);
    }
  });
  it('sim/ and gen/ never import from game/', () => {
    for (const [path, raw] of Object.entries(sources)) expect(raw, path).not.toMatch(/from '\.\.\/game/);
  });
});
