import { T } from '../tuning';
import type { Director } from './director';
import type { Tracker } from './tracker';
import { World } from './world';

export type WorkerStats = { solved: number; discarded: number; msPerChunk: number };

export type HudData = {
  tracker: Tracker;
  director: Director;
  world: World;
  playerCol: number;
  stats: WorkerStats;
  seed: number;
  fps: number;
  targets: [number, number, number];
};

const f2 = (v: number) => v.toFixed(2);

/** The numbers behind every decision. Toggle with H. */
export function drawHud(ctx: CanvasRenderingContext2D, d: HudData): void {
  const { tracker, director, world } = d;
  const segIdx = Math.floor(d.playerCol / T.segW);
  const lines: string[] = [];
  lines.push(`s = ${f2(tracker.s)}   scored chunks: ${tracker.scored}   seed ${d.seed}   ${d.fps.toFixed(0)} fps`);
  lines.push(`lane targets  L0 ${f2(d.targets[0])}   L1 ${f2(d.targets[1])}   L2 ${f2(d.targets[2])}`);
  for (const si of [segIdx, segIdx + 1]) {
    const seg = world.segments.get(si);
    if (!seg) continue;
    const ds = seg.chunks.map((c) => (c.score.T0 > 0 ? f2(c.score.D) : ' -- '));
    lines.push(`segment ${si}   actual D  L0 ${ds[0]}   L1 ${ds[1]}   L2 ${ds[2]}`);
  }
  const o = tracker.last;
  lines.push(
    o
      ? `last chunk: ${o.kind}  o=${f2(o.o)}  time ratio ${f2(o.ratio)}  D=${f2(o.D)}  s ${f2(o.sBefore)} -> ${f2(o.sAfter)}`
      : 'last chunk: none yet',
  );
  const bins = director.binCounts();
  lines.push(`bank ${director.bank.length}/${T.runtime.bankMax}  per D bin: ${bins.join(' ')}`);
  const total = d.stats.solved + d.stats.discarded;
  lines.push(
    `bank misses ${director.misses}   worker ${d.stats.msPerChunk.toFixed(0)} ms/chunk   solved ${d.stats.solved}   discarded ${d.stats.discarded} (${total ? ((100 * d.stats.discarded) / total).toFixed(0) : 0}%)`,
  );
  lines.push('H hud   G bot ghost   R restart');

  ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
  ctx.fillStyle = 'rgba(10, 12, 20, 0.72)';
  ctx.fillRect(8, 8, w, lines.length * 20 + 12);
  ctx.fillStyle = '#e8ecf5';
  lines.forEach((l, i) => ctx.fillText(l, 18, 30 + i * 20));
}

export function drawCentred(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.fillStyle = '#1b1d26';
  ctx.fillRect(0, 0, T.runtime.canvasW, T.runtime.canvasH);
  ctx.fillStyle = '#e8ecf5';
  ctx.font = '28px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, T.runtime.canvasW / 2, T.runtime.canvasH / 2);
  ctx.textAlign = 'start';
}
