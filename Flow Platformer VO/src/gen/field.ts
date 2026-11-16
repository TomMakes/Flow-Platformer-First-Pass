import { T } from '../tuning';
import { Tile, type Grid } from '../sim/types';
import { isSolid } from '../sim/grid';

export const UNREACHABLE = 1e6;

/** Route distance field: BFS step count (in tiles) from goal tiles, through non-solid tiles. */
export class Field {
  readonly d: Float32Array;
  constructor(public grid: Grid, public w: number, public h: number, goalCols: number[]) {
    this.d = new Float32Array(w * h).fill(UNREACHABLE);
    const q = new Int32Array(w * h);
    let head = 0, tail = 0;
    for (const c of goalCols) for (let y = 0; y < h; y++) if (this.open(c, y)) { this.d[y * w + c] = 0; q[tail++] = y * w + c; }
    while (head < tail) {
      const i = q[head++];
      const x = i % w, y = (i / w) | 0;
      const nd = this.d[i] + 1;
      const nb = [x - 1, y, x + 1, y, x, y - 1, x, y + 1];
      for (let k = 0; k < 8; k += 2) {
        const nx = nb[k], ny = nb[k + 1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !this.open(nx, ny)) continue;
        const j = ny * w + nx;
        if (this.d[j] > nd) { this.d[j] = nd; q[tail++] = j; }
      }
    }
  }
  open(x: number, y: number): boolean {
    const t = this.grid.get(x, y);
    return !isSolid(t) || t === Tile.ONEWAY;
  }
  at(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return UNREACHABLE;
    return this.d[ty * this.w + tx];
  }
  /** Bilinear sample at a pixel position (tile centres are the sample points). */
  sample(px: number, py: number): number {
    const fx = px / T.tile - 0.5, fy = py / T.tile - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const ax = fx - x0, ay = fy - y0;
    const a = this.at(x0, y0), b = this.at(x0 + 1, y0), c = this.at(x0, y0 + 1), e = this.at(x0 + 1, y0 + 1);
    if (a < UNREACHABLE && b < UNREACHABLE && c < UNREACHABLE && e < UNREACHABLE)
      return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + e * ax) * ay;
    const near = this.at(Math.floor(px / T.tile), Math.floor(py / T.tile));
    if (near < UNREACHABLE) return near;
    return Math.min(a, b, c, e);
  }
}

export const chunkField = (grid: Grid): Field => new Field(grid, T.chunkW, T.chunkH, [T.bot.goalCol]);
