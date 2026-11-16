import { T } from '../tuning';
import { isSolid } from '../sim/grid';

export const UNREACHABLE = 1e9;

/** BFS distance (in tiles, four-connected through non-solid tiles) from column `goalCol`. */
export function buildField(tiles: Uint8Array, CW: number = T.chunkW, CH: number = T.chunkH, goalCol: number = T.goalCol): Float32Array {
  const field = new Float32Array(CW * CH).fill(UNREACHABLE);
  const queue: number[] = [];
  for (let r = 0; r < CH; r++) {
    const idx = r * CW + goalCol;
    if (!isSolid(tiles[idx]!)) { field[idx] = 0; queue.push(idx); }
  }
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head]!;
    const c = idx % CW, r = (idx - c) / CW;
    const d = field[idx]! + 1;
    const nbrs: Array<[number, number]> = [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]];
    for (const [nc, nr] of nbrs) {
      if (nc < 0 || nc >= CW || nr < 0 || nr >= CH) continue;
      const ni = nr * CW + nc;
      if (isSolid(tiles[ni]!) || field[ni]! <= d) continue;
      field[ni] = d;
      queue.push(ni);
    }
  }
  return field;
}

/**
 * Sample the field at pixel (px, py) with bilinear interpolation over neighbouring reachable tiles.
 * Solid neighbours are left out of the weighting; with none reachable, fall back to the nearest tile.
 */
export function sampleField(field: Float32Array, px: number, py: number, CW: number = T.chunkW, CH: number = T.chunkH): number {
  const u = px / T.tile - 0.5;
  const v = Math.min(py / T.tile, CH - 0.5) - 0.5;
  const c0 = Math.floor(u), r0 = Math.floor(v);
  const fu = u - c0, fv = v - r0;
  let sum = 0, wsum = 0;
  for (let dr = 0; dr <= 1; dr++) {
    for (let dc = 0; dc <= 1; dc++) {
      const c = c0 + dc, r = r0 + dr;
      if (c < 0 || c >= CW || r < 0 || r >= CH) continue;
      const val = field[r * CW + c]!;
      if (val >= UNREACHABLE) continue;
      const w = (dc ? fu : 1 - fu) * (dr ? fv : 1 - fv);
      sum += w * val;
      wsum += w;
    }
  }
  if (wsum > 1e-9) return sum / wsum;
  const c = Math.max(0, Math.min(CW - 1, Math.round(u)));
  const r = Math.max(0, Math.min(CH - 1, Math.round(v)));
  return field[r * CW + c]!;
}
