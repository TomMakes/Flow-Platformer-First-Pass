import { T } from '../tuning';
import type { TileGrid } from '../sim/grid';
import { Tile, type PlayerState } from '../sim/types';

export type Camera = { x: number; y: number };

const TS = T.tile;
const COLORS: Record<number, string> = {
  [Tile.SOLID]: '#4b5367',
  [Tile.ONEWAY]: '#7fb7d9',
  [Tile.MUD]: '#7a5a3a',
  [Tile.BUMPER]: '#e0528a',
};

export function makeCamera(): Camera {
  return { x: 0, y: 0 };
}

/** Player one third from the left; vertical follow is smoothed. */
export function updateCamera(cam: Camera, p: PlayerState, snap = false): void {
  const cx = p.x + T.playerW / 2;
  const cy = p.y + T.playerH / 2;
  cam.x = cx - T.runtime.canvasW / 3;
  const targetY = cy - T.runtime.canvasH / 2;
  cam.y = snap ? targetY : cam.y + (targetY - cam.y) * T.runtime.cameraSmooth;
}

export type TileTint = (col: number, row: number) => string | null;

export function drawTiles(ctx: CanvasRenderingContext2D, grid: TileGrid, cam: Camera, floorTint?: TileTint): void {
  const W = T.runtime.canvasW, H = T.runtime.canvasH;
  const c0 = Math.floor(cam.x / TS), c1 = Math.floor((cam.x + W) / TS);
  const r0 = Math.max(0, Math.floor(cam.y / TS)), r1 = Math.floor((cam.y + H) / TS);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = grid.get(c, r);
      if (t === Tile.EMPTY) continue;
      const tint = floorTint ? floorTint(c, r) : null;
      ctx.fillStyle = (t === Tile.SOLID && tint) || COLORS[t] || '#f0f';
      const px = c * TS - cam.x, py = r * TS - cam.y;
      if (t === Tile.ONEWAY) ctx.fillRect(px, py, TS, 8);
      else ctx.fillRect(px, py, TS, TS);
    }
  }
}

export function drawPlayer(ctx: CanvasRenderingContext2D, p: PlayerState, cam: Camera): void {
  ctx.fillStyle = p.wallDir !== 0 ? '#ffd166' : '#f4f1de';
  ctx.fillRect(p.x - cam.x, p.y - cam.y, T.playerW, T.playerH);
}

/** Outline of the bot's clean run for one chunk, looping. `gx, gy` are the chunk's world pixel origin. */
export function drawGhost(
  ctx: CanvasRenderingContext2D, ghost: Float32Array, frame: number, ox: number, oy: number, cam: Camera,
): void {
  const n = ghost.length / 2;
  if (n === 0) return;
  const i = frame % (n + 45);
  const k = Math.min(i, n - 1);
  const cx = ox + ghost[k * 2]!, cy = oy + ghost[k * 2 + 1]!;
  ctx.strokeStyle = '#7CFC9A';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - T.playerW / 2 - cam.x, cy - T.playerH / 2 - cam.y, T.playerW, T.playerH);
}
