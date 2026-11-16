import { T } from '../src/tuning';
import { GenCore } from '../src/gen/genCore';
import { type Chunk, type Input, type PlayerState } from '../src/sim/types';
import type { ChunkFeed } from '../src/game/director';
import { Session } from '../src/game/session';
import { laneOfRow, laneTop } from '../src/game/world';
import { beamSearch, chunkGoal, chunkFell } from '../src/gen/bot';
import { chunkField } from '../src/gen/field';
import { ChunkGrid } from '../src/sim/grid';

/** Runs the generation core synchronously: an epoch is produced the moment it is requested. */
export class SyncFeed implements ChunkFeed {
  core: GenCore;
  out: Chunk[] = [];
  constructor(seed: number) { this.core = new GenCore(seed); }
  sendState(epoch: number, s: number, binCounts: number[]): void {
    for (const c of this.core.epoch({ epoch, s, binCounts })) this.out.push(c);
  }
  drain(): Chunk[] { const o = this.out; this.out = []; return o; }
}

/** Hold right; jump only to escape walls and pits. Falls into every hole. */
export function fallerAgent() {
  let prev = false;
  return (p: PlayerState): Input => {
    const row = Math.floor((p.y + T.playerH / 2) / T.tile);
    const inPit = laneOfRow(row) === 3;
    const blocked = p.grounded && Math.abs(p.vx) < 0.5;
    const want = inPit ? (p.grounded || p.wallDir !== 0) : blocked || p.wallDir !== 0;
    const jump = (want && !prev) || (prev && p.vy < 0);
    prev = jump;
    return { dir: 1, jump };
  };
}

/** A skilled player: plans each chunk with the bot from its actual position; otherwise behaves like the faller. */
export function replayAgent(sess: Session) {
  const fall = fallerAgent();
  let run: Input[] | null = null, idx = 0, key = '';
  return (p: PlayerState): Input => {
    const cx = (p.x + T.playerW / 2) / T.tile;
    const seg = Math.floor(cx / T.chunkW), local = cx - seg * T.chunkW;
    const lane = laneOfRow(Math.floor((p.y + T.playerH / 2) / T.tile));
    const k = `${seg}:${lane}`;
    if (!run && k !== key && lane <= 2 && p.grounded && local >= T.bot.startCol && local < T.bot.startCol + 0.5) {
      const c = sess.world.segs.get(seg)?.chunks[lane];
      key = k;
      if (c) {
        const g = new ChunkGrid(c.tiles);
        const start = { ...p, x: p.x - seg * T.chunkW * T.tile, y: p.y - laneTop(lane) * T.tile };
        const plan = beamSearch(g, { start, field: chunkField(g), isGoal: chunkGoal, isDead: chunkFell });
        if (plan) { run = plan.inputs; idx = 0; }
      }
    }
    if (run) {
      if (idx < run.length) return run[idx++];
      run = null;
    }
    return fall(p);
  };
}

export function play(sess: Session, agent: (p: PlayerState) => Input, frames: number): Input[] {
  const log: Input[] = [];
  for (let f = 0; f < frames; f++) {
    const i = agent(sess.player);
    if (sess.tick(i)) log.push(i);
  }
  return log;
}
