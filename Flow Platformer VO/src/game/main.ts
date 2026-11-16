import { T } from '../tuning';
import { Tile, type Chunk } from '../sim/types';
import { step, playerOnFloor } from '../sim/physics';
import { testLevel, TEST_FLOOR_ROW } from '../sim/testLevel';
import { Keyboard } from './input';
import { Renderer, type HudStats } from './render';
import { Session, type Mode } from './session';
import type { ChunkFeed } from './director';

const STEP_MS = 1000 / T.fps;

/** Chunk feed backed by the generation web worker. */
class WorkerFeed implements ChunkFeed {
  private worker: Worker;
  private inbox: Chunk[] = [];
  stats = { solved: 0, discarded: 0, msPerChunk: 0 };
  private lastMark = 0;
  private busy = false;
  constructor(seed: number) {
    this.worker = new Worker(new URL('../gen/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'chunk') {
        this.inbox.push(m.chunk as Chunk);
        const now = performance.now();
        if (this.busy) {
          const ms = now - this.lastMark;
          this.stats.msPerChunk = this.stats.msPerChunk ? this.stats.msPerChunk * 0.8 + ms * 0.2 : ms;
        }
        this.lastMark = now;
        this.busy = true;
      } else if (m.type === 'stats') {
        this.stats.solved = m.solved;
        this.stats.discarded = m.discarded;
      }
    };
    this.worker.postMessage({ type: 'init', seed });
  }
  sendState(epoch: number, s: number, binCounts: number[]): void {
    this.lastMark = performance.now();
    this.busy = true;
    this.worker.postMessage({ type: 'state', epoch, s, binCounts });
  }
  drain(): Chunk[] { const o = this.inbox; this.inbox = []; return o; }
  terminate(): void { this.worker.terminate(); }
}

function params() {
  const q = new URLSearchParams(location.search);
  const seedParam = q.get('seed');
  const seed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  if (seedParam === null) { q.set('seed', String(seed)); history.replaceState(null, '', `?${q}`); }
  const mode: Mode = q.get('mode') === 'fixed' ? 'fixed' : 'adaptive';
  return { seed, mode, level: q.get('level'), q };
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const kb = new Keyboard();
const { seed, mode, level, q } = params();

function restartWithNewSeed(): void {
  q.set('seed', String((Math.random() * 2 ** 32) >>> 0));
  location.search = `?${q}`;
}

if (level === 'test') runTestLevel();
else runGame();

function runGame(): void {
  const feed = mode === 'adaptive' ? new WorkerFeed(seed) : null;
  const sess = new Session(seed, mode, feed);
  (window as unknown as { flow: Session }).flow = sess; // debug handle for the console
  const r = new Renderer(ctx);
  r.follow(sess, true);
  let acc = 0, last = performance.now(), fps = 60;
  const frame = (now: number) => {
    const dt = Math.min(250, now - last);
    last = now;
    fps = fps * 0.95 + (1000 / Math.max(1, dt)) * 0.05;
    for (const k of kb.takePressed()) {
      if (k === 'KeyH') r.hud = !r.hud;
      else if (k === 'KeyG') r.ghost = !r.ghost;
      else if (k === 'KeyR') { feed?.terminate(); restartWithNewSeed(); return; }
    }
    acc += dt;
    let steps = 0;
    while (acc >= STEP_MS && steps < T.maxStepsPerRender) {
      sess.tick(kb.read());
      acc -= STEP_MS;
      steps++;
    }
    if (steps === T.maxStepsPerRender) acc = Math.min(acc, STEP_MS);
    r.follow(sess);
    const stats: HudStats = { ...(feed?.stats ?? { solved: 0, discarded: 0, msPerChunk: 0 }), fps, seed, mode };
    const waiting = sess.waiting ? (sess.started ? 'Generating…' : 'Generating') : null;
    r.draw(sess, stats, waiting);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Milestone-1 sandbox: the hand-written test level. Open with ?level=test. */
function runTestLevel(): void {
  const grid = testLevel();
  const start = () => playerOnFloor(2, TEST_FLOOR_ROW);
  let p = start();
  let acc = 0, last = performance.now();
  const TS = T.tile;
  const colors: Record<number, string> = { [Tile.SOLID]: '#3b4252', [Tile.ONEWAY]: '#88c0d0', [Tile.MUD]: '#8a6236', [Tile.BUMPER]: '#ff5ca8' };
  const frame = (now: number) => {
    acc += Math.min(250, now - last);
    last = now;
    for (const k of kb.takePressed()) if (k === 'KeyR') p = start();
    let n = 0;
    while (acc >= STEP_MS && n < T.maxStepsPerRender) { p = step(p, kb.read(), grid); acc -= STEP_MS; n++; }
    if (p.x > (grid.w - 2) * TS) p = start();
    const camX = Math.max(0, p.x - T.render.width / 3);
    ctx.fillStyle = '#12141a';
    ctx.fillRect(0, 0, T.render.width, T.render.height);
    ctx.save();
    ctx.translate(-Math.round(camX), 200);
    for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
      const t = grid.get(x, y);
      if (t === Tile.EMPTY) continue;
      ctx.fillStyle = colors[t];
      if (t === Tile.ONEWAY) ctx.fillRect(x * TS, y * TS, TS, 8);
      else ctx.fillRect(x * TS, y * TS, TS, TS);
    }
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(p.x, p.y, T.playerW, T.playerH);
    ctx.restore();
    ctx.fillStyle = '#e5e9f0';
    ctx.font = '14px ui-monospace, monospace';
    ctx.fillText(`test level   vx ${p.vx.toFixed(2)} vy ${p.vy.toFixed(2)} grounded ${p.grounded} wall ${p.wallDir}   [R] reset`, 16, 28);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
