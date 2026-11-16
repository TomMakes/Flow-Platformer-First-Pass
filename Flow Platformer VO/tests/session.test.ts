import { describe, it, expect } from 'vitest';
import { Session } from '../src/game/session';
import { SyncFeed, fallerAgent, replayAgent, play } from './helpers';
import { laneTargets } from '../src/game/director';

const newSession = (seed: number) => new Session(seed, 'adaptive', new SyncFeed(seed));

describe('session', () => {
  it('falling into every hole pulls s down within five scored chunks', { timeout: 60000 }, () => {
    const sess = newSession(11);
    const agent = fallerAgent();
    const s0 = sess.tracker.s;
    for (let f = 0; f < 60 * 120 && sess.tracker.scored < 5; f++) sess.tick(agent(sess.player));
    expect(sess.tracker.scored).toBeGreaterThanOrEqual(5);
    expect(sess.tracker.s).toBeLessThan(s0);
  });

  it('clean runs push s up, above 0.5 within ten chunks', { timeout: 60000 }, () => {
    const sess = newSession(12);
    const agent = replayAgent(sess);
    for (let f = 0; f < 60 * 120 && sess.tracker.scored < 10; f++) sess.tick(agent(sess.player));
    const h = sess.tracker.history;
    const clean = h.filter((r) => r.outcome === 'clean').length;
    expect(clean).toBeGreaterThanOrEqual(7);
    expect(Math.max(...h.map((r) => r.sAfter))).toBeGreaterThan(0.5);
  });

  it('lanes are ordered by difficulty and the bank never misses after startup', { timeout: 90000 }, () => {
    const sess = newSession(13);
    const agent = replayAgent(sess);
    let segs = 0, ordered = 0;
    sess.onAssemble = (_seg, pick) => {
      segs++;
      const [a, b, c] = pick.chunks.map((ch) => ch.score.D);
      if (a > b && b > c) ordered++;
    };
    play(sess, agent, 60 * 90);
    expect(segs).toBeGreaterThanOrEqual(10);
    expect(ordered / segs).toBeGreaterThanOrEqual(0.9);
    expect(sess.director.misses).toBe(0);
    const t = laneTargets(0.5);
    expect(t[0]).toBeGreaterThan(t[1]);
  });

  it('the same seed with the same inputs reproduces the same session', { timeout: 60000 }, () => {
    const a = newSession(21);
    const inputs = play(a, replayAgent(a), 60 * 40);
    const b = newSession(21);
    for (const i of inputs) b.tick(i);
    expect(b.player).toEqual(a.player);
    expect(b.tracker.history).toEqual(a.tracker.history);
    expect(b.frame).toBe(a.frame);
  });
});
