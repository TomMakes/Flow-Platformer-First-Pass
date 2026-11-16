import { T } from '../tuning';
import { Tile, type Grid } from './types';

const TS = T.tile;

/** Solid on X and on Y from below. ONEWAY is handled separately. */
export const isSolid = (t: number): boolean => t === Tile.SOLID || t === Tile.MUD;

/** True for the tiles of the ascent gate's hanging wall, in chunk-local coordinates. */
export const isGateWall = (tx: number, ty: number): boolean => tx === T.gateCol && ty >= 0 && ty < T.gateHangLength;

/** A chunk on its own, as the bot sees it: solid above row 0 and left of
 *  column 0, open below the floor row, flat floor continuing to the right.
 *  The gate's hanging wall is included because every lane has it in the world. */
export class ChunkGrid implements Grid {
  constructor(public tiles: Uint8Array, public w = T.chunkW, public h = T.chunkH, public gate = true) {}
  get(tx: number, ty: number): number {
    if (ty < 0 || tx < 0) return Tile.SOLID;
    if (this.gate && isGateWall(tx, ty)) return Tile.SOLID;
    if (ty >= this.h) return Tile.EMPTY;
    if (tx >= this.w) return ty === this.h - 1 ? Tile.SOLID : Tile.EMPTY;
    return this.tiles[ty * this.w + tx];
  }
}

export const tileOf = (px: number): number => Math.floor(px / TS);

/** Does the box [x, x+w) x [y, y+h) overlap any tile matching pred? */
export function boxHits(grid: Grid, x: number, y: number, w: number, h: number, pred: (t: number) => boolean): boolean {
  const x0 = tileOf(x), x1 = tileOf(x + w - 1e-6);
  const y0 = tileOf(y), y1 = tileOf(y + h - 1e-6);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (pred(grid.get(tx, ty))) return true;
  return false;
}

const CHAR_TILE: Record<string, number> = { '.': Tile.EMPTY, '#': Tile.SOLID, '=': Tile.ONEWAY, 'm': Tile.MUD, 'b': Tile.BUMPER };

/** A closed rectangular grid built from text rows; everything outside is solid. */
export class TextGrid implements Grid {
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  constructor(rows: string[]) {
    this.h = rows.length;
    this.w = Math.max(...rows.map((r) => r.length));
    this.tiles = new Uint8Array(this.w * this.h);
    rows.forEach((r, y) => { for (let x = 0; x < this.w; x++) this.tiles[y * this.w + x] = CHAR_TILE[r[x] ?? '#'] ?? Tile.SOLID; });
  }
  get(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return Tile.SOLID;
    return this.tiles[ty * this.w + tx];
  }
}
