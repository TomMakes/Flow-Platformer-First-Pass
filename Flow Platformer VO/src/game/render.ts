import { T } from '../tuning';
import { Tile, decodeInput, type Chunk, type PlayerState } from '../sim/types';
import { ChunkGrid } from '../sim/grid';
import { step } from '../sim/physics';
import { chunkStart } from '../gen/bot';
import { laneTop, laneFloor } from './world';
import type { Session } from './session';
import { laneTargets } from './director';
import { binOf } from '../gen/genCore';

const TS = T.tile, R = T.render;
const COLORS: Record<number, string> = {
  [Tile.SOLID]: '#3b4252', [Tile.ONEWAY]: '#88c0d0', [Tile.MUD]: '#8a6236', [Tile.BUMPER]: '#ff5ca8',
};
const LANE_NAME = ['top', 'mid', 'low'];

/** Green (D = 0) through amber to red (D = 1). */
export const dColor = (D: number, alpha = 1): string => `hsla(${Math.round(130 * (1 - Math.max(0, Math.min(1, D))))}, 70%, 50%, ${alpha})`;

export type HudStats = { solved: number; discarded: number; msPerChunk: number; fps: number; seed: number; mode: string };

export class Renderer {
  camX = 0;
  camY = 0;
  hud = true;
  ghost = false;
  private ghostCache = new WeakMap<Chunk, PlayerState[]>();
  constructor(public ctx: CanvasRenderingContext2D) {}

  private ghostTrace(c: Chunk): PlayerState[] | null {
    if (!c.run) return null;
    let tr = this.ghostCache.get(c);
    if (!tr) {
      const g = new ChunkGrid(c.tiles);
      let s = chunkStart();
      tr = [s];
      for (const code of c.run) { s = step(s, decodeInput(code), g); tr.push(s); }
      this.ghostCache.set(c, tr);
    }
    return tr;
  }

  follow(sess: Session, snap = false): void {
    const p = sess.player;
    const maxY = T.worldRows * TS - R.height;
    const tx = p.x + T.playerW / 2 - R.width * R.playerScreenX;
    const ty = Math.max(0, Math.min(maxY, p.y + T.playerH / 2 - R.height / 2));
    this.camX = tx;
    this.camY = snap ? ty : this.camY + (ty - this.camY) * R.camSmoothY;
  }

  draw(sess: Session, stats: HudStats, waitingText: string | null): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#12141a';
    ctx.fillRect(0, 0, R.width, R.height);
    ctx.save();
    ctx.translate(-Math.round(this.camX), -Math.round(this.camY));

    const x0 = Math.floor(this.camX / TS) - 1, x1 = Math.ceil((this.camX + R.width) / TS) + 1;
    const y0 = Math.max(0, Math.floor(this.camY / TS)), y1 = Math.min(T.worldRows - 1, Math.ceil((this.camY + R.height) / TS));

    // Lane backgrounds tinted faintly by difficulty.
    for (const seg of sess.world.segs.values()) {
      const sx = seg.index * T.chunkW * TS;
      if (sx > this.camX + R.width || sx + T.chunkW * TS < this.camX) continue;
      seg.chunks.forEach((c, lane) => {
        ctx.fillStyle = dColor(c.score.D, 0.06);
        ctx.fillRect(sx, laneTop(lane) * TS, T.chunkW * TS, 8 * TS);
      });
    }

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = sess.world.get(tx, ty);
        if (t === Tile.EMPTY) continue;
        const px = tx * TS, py = ty * TS;
        const seg = sess.world.segs.get(Math.floor(tx / T.chunkW));
        if (!seg) continue;
        if (t === Tile.ONEWAY) { ctx.fillStyle = COLORS[t]; ctx.fillRect(px, py, TS, 8); continue; }
        if (t === Tile.BUMPER) {
          ctx.fillStyle = COLORS[t];
          ctx.beginPath(); ctx.arc(px + TS / 2, py + TS / 2, TS * 0.38, 0, Math.PI * 2); ctx.fill();
          continue;
        }
        const lane = [0, 1, 2].find((l) => ty === laneFloor(l));
        ctx.fillStyle = lane !== undefined && t === Tile.SOLID ? dColor(seg.chunks[lane].score.D, 0.85) : COLORS[t];
        ctx.fillRect(px, py, TS, TS);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(px, py + TS - 3, TS, 3);
      }
    }

    // Ghost: each visible chunk's clean run, looping.
    if (this.ghost) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      for (const seg of sess.world.segs.values()) {
        const sx = seg.index * T.chunkW * TS;
        if (sx > this.camX + R.width || sx + T.chunkW * TS < this.camX) continue;
        seg.chunks.forEach((c, lane) => {
          const tr = this.ghostTrace(c);
          if (!tr) return;
          const s = tr[sess.frame % (tr.length + R.ghostPad)] ?? tr[tr.length - 1];
          ctx.strokeRect(sx + s.x + 1, laneTop(lane) * TS + s.y + 1, T.playerW - 2, T.playerH - 2);
        });
      }
    }

    const p = sess.player;
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(p.x, p.y, T.playerW, T.playerH);
    ctx.fillStyle = '#12141a';
    const eye = p.vx < -0.1 ? 3 : T.playerW - 8;
    ctx.fillRect(p.x + eye, p.y + 8, 5, 5);
    ctx.restore();

    if (this.hud) this.drawHud(sess, stats);
    else this.drawMiniHud(sess);
    if (waitingText) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, R.height / 2 - 40, R.width, 80);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(waitingText, R.width / 2, R.height / 2 + 10);
      ctx.textAlign = 'left';
    }
  }

  private panel(x: number, y: number, w: number, h: number): void {
    this.ctx.fillStyle = 'rgba(10,12,16,0.78)';
    this.ctx.fillRect(x, y, w, h);
  }

  private drawMiniHud(sess: Session): void {
    const ctx = this.ctx;
    const seg = sess.world.segs.get(Math.floor(sess.playerTileX / T.chunkW));
    this.panel(8, 8, 300, 30);
    ctx.font = '14px ui-monospace, monospace';
    ctx.fillStyle = '#e5e9f0';
    const ds = seg ? seg.chunks.map((c) => c.score.D.toFixed(2)).join(' / ') : '-';
    ctx.fillText(`s ${sess.tracker.s.toFixed(2)}   D ${ds}   [H] HUD`, 16, 28);
  }

  private drawHud(sess: Session, st: HudStats): void {
    const ctx = this.ctx;
    const tr = sess.tracker;
    const segIdx = Math.floor(sess.playerTileX / T.chunkW);
    this.panel(8, 8, 430, 262);
    ctx.font = '14px ui-monospace, monospace';
    let y = 28;
    const line = (txt: string, color = '#e5e9f0') => { ctx.fillStyle = color; ctx.fillText(txt, 16, y); y += 19; };
    line(`skill s  ${tr.s.toFixed(3)}    scored ${tr.scored}    k ${(tr.scored < T.tracker.kEarlyChunks ? T.tracker.kEarly : T.tracker.kLate).toFixed(2)}`, '#ffd84a');
    const tg = laneTargets(tr.s);
    line(`targets  ${tg.map((t) => t.toFixed(2)).join(' / ')}`);
    for (const k of [segIdx, segIdx + 1]) {
      const seg = sess.world.segs.get(k);
      if (!seg) continue;
      const pk = sess.picks.get(k);
      const txt = seg.chunks.map((c, l) => `${LANE_NAME[l]} ${c.score.D.toFixed(2)}`).join('  ');
      line(`seg ${k}${k === segIdx ? '*' : ' '} D  ${txt}${pk && pk.misses ? `  miss ${pk.misses}` : ''}`);
    }
    const last = tr.last;
    if (last) {
      const col = last.outcome === 'clean' ? '#a3e635' : last.outcome === 'rough' ? '#fbbf24' : '#f87171';
      line(`last     ${last.outcome}${last.fell ? ' (fell)' : ''}  ratio ${last.ratio.toFixed(2)}  D ${last.D.toFixed(2)}  ${LANE_NAME[last.lane]}`, col);
      line(`         s ${last.sBefore.toFixed(3)} -> ${last.sAfter.toFixed(3)}`, col);
    } else { line('last     -'); line(''); }
    const att = tr.attempt;
    line(att ? `tracking seg ${att.seg} ${LANE_NAME[att.lane]}  T0 ${att.chunk.score.T0}  ${sess.frame - att.startFrame}f` : 'tracking -', '#9aa5b8');
    const d = sess.director;
    const bank = 'bank' in d ? d.bank : [];
    line(`bank ${bank.length}   misses ${d.misses}   worker ${st.msPerChunk.toFixed(1)} ms/chunk`);
    const tot = st.solved + st.discarded;
    line(`solved ${st.solved}   discard rate ${tot ? ((100 * st.discarded) / tot).toFixed(1) : '0.0'}%   fps ${st.fps.toFixed(0)}`);
    line(`seed ${st.seed}   mode ${st.mode}   [G] ghost ${this.ghost ? 'on' : 'off'}   [R] new seed`, '#9aa5b8');

    // Bank histogram by D bin.
    const bins = new Array(T.director.bins).fill(0);
    for (const c of bank) bins[binOf(c.score.D)]++;
    const bx = 16, by = y + 2, bw = 40, bh = 40;
    const max = Math.max(4, ...bins);
    bins.forEach((n, i) => {
      const h = (n / max) * bh;
      ctx.fillStyle = dColor((i + 0.5) / bins.length, 0.9);
      ctx.fillRect(bx + i * bw, by + bh - h, bw - 4, h);
      ctx.fillStyle = '#9aa5b8';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(String(n), bx + i * bw + 2, by + bh - h - 3);
    });
    // marker for s
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(bx + tr.s * bw * bins.length - 1, by - 4, 2, bh + 8);
  }
}
