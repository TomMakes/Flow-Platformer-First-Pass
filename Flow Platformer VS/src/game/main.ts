import { T } from '../tuning';
import { flatChunk } from '../gen/generator';
import { makeStanding, step } from '../sim/physics';
import type { Chunk, PlayerState } from '../sim/types';
import { Director, fixedSegment } from './director';
import { drawCentred, drawHud, type WorkerStats } from './hud';
import { KeyboardInput } from './input';
import { drawGhost, drawPlayer, drawTiles, makeCamera, updateCamera } from './render';
import { Tracker } from './tracker';
import { floorTint, laneFloorRow, World } from './world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const input = new KeyboardInput();
const params = new URLSearchParams(location.search);
const fixedMode = params.get('fixed') === '1'; // debug: fixed lane intensities, no worker

const tracker = new Tracker();
const director = new Director();
const cam = makeCamera();
let world = new World();
let player: PlayerState = makeStanding(0, 0);
let seed = 0;
let started = false;
let showHud = true;
let showGhost = false;
let ghostFrame = 0;
let stats: WorkerStats = { solved: 0, discarded: 0, msPerChunk: 0 };
let lastTargets: [number, number, number] = Director.targets(T.tracker.startS);

const worker = fixedMode ? null : new Worker(new URL('../gen/worker.ts', import.meta.url), { type: 'module' });

function pickSeed(fromUrl: boolean): number {
  const q = params.get('seed');
  return fromUrl && q !== null && q !== '' ? Number(q) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
}

function sendState(): void {
  worker?.postMessage({ type: 'state', s: tracker.s, binCounts: director.binCounts() });
}

function newSegment(): void {
  if (fixedMode) {
    world.addSegment(fixedSegment(seed, world.nextIndex));
    return;
  }
  const pick = director.pick(tracker.s);
  lastTargets = pick.targets;
  world.addSegment(pick.chunks);
  sendState();
}

function begin(): void {
  world = new World();
  world.addSegment([flatChunk(), flatChunk(), flatChunk()]); // segment 0: learn the movement
  newSegment();
  player = makeStanding(6 * T.tile, laneFloorRow(1) * T.tile);
  tracker.reset();
  updateCamera(cam, player, true);
  started = true;
}

function restart(fromUrl: boolean): void {
  seed = pickSeed(fromUrl);
  started = false;
  director.clear();
  tracker.reset();
  stats = { solved: 0, discarded: 0, msPerChunk: 0 };
  if (worker) worker.postMessage({ type: 'init', seed });
  sendState();
  if (fixedMode) begin();
}

worker?.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as { type: string; chunk?: Chunk } & Partial<WorkerStats>;
  if (m.type === 'chunk' && m.chunk) {
    director.add(m.chunk, tracker.s);
    if (!started && director.ready(tracker.s)) begin();
  } else if (m.type === 'stats') {
    stats = { solved: m.solved ?? 0, discarded: m.discarded ?? 0, msPerChunk: m.msPerChunk ?? 0 };
  }
});

const playerCol = () => (player.x + T.playerW / 2) / T.tile;

function assembleIfDue(): void {
  while (world.nextIndex * T.segW - playerCol() <= T.runtime.assembleAhead) newSegment();
  world.discardBefore(Math.floor(playerCol() / T.segW) - T.runtime.keepBehindSegments);
}

function drawGhosts(): void {
  const base = Math.floor(playerCol() / T.segW);
  for (let si = base - 1; si <= base + 1; si++) {
    world.segments.get(si)?.chunks.forEach((chunk, lane) => {
      if (chunk.ghost) drawGhost(ctx, chunk.ghost, ghostFrame, si * T.segW * T.tile, lane * T.chunkH * T.tile, cam);
    });
  }
}

restart(true);

let last = performance.now();
let acc = 0;
let fps = 60;
function frame(now: number) {
  const dtMs = now - last;
  last = now;
  fps = fps * 0.95 + (1000 / Math.max(1, dtMs)) * 0.05;
  if (input.consume('KeyH')) showHud = !showHud;
  if (input.consume('KeyG')) showGhost = !showGhost;
  if (input.consume('KeyR')) restart(false);

  if (!started) {
    drawCentred(ctx, `Generating... bank ${director.bank.length}/${T.runtime.startBankMin}`);
    requestAnimationFrame(frame);
    return;
  }

  acc += Math.min(0.25, dtMs / 1000);
  let n = 0;
  while (acc >= T.dt && n < T.maxStepsPerFrame) {
    player = step(player, input.read(), world);
    if (tracker.update(player, world)) sendState(); // skill updated: tell the worker
    assembleIfDue();
    acc -= T.dt;
    n++;
  }
  if (n === T.maxStepsPerFrame) acc = 0;

  updateCamera(cam, player);
  ctx.fillStyle = '#1b1d26';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawTiles(ctx, world, cam, (c, r) => floorTint(world, c, r));
  drawPlayer(ctx, player, cam);
  if (showGhost) { ghostFrame++; drawGhosts(); }
  if (showHud) drawHud(ctx, { tracker, director, world, playerCol: playerCol(), stats, seed, fps, targets: lastTargets });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
