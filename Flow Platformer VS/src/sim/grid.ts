import { T } from '../tuning';
import { Tile } from './types';

export interface TileGrid {
  get(col: number, row: number): number;
}

export function isSolid(t: number): boolean {
  return t === Tile.SOLID || t === Tile.MUD;
}

export type OobRule = { left: number; right: number; top: number; bottom: number };

/** A plain rectangular tile array. Out-of-bounds values are configurable per side. */
export class ArrayGrid implements TileGrid {
  constructor(
    readonly w: number,
    readonly h: number,
    readonly tiles: Uint8Array,
    readonly oob: OobRule = { left: Tile.SOLID, right: Tile.SOLID, top: Tile.SOLID, bottom: Tile.EMPTY },
  ) {}
  get(col: number, row: number): number {
    if (row < 0) return this.oob.top;
    if (col < 0) return this.oob.left;
    if (col >= this.w) return this.oob.right;
    if (row >= this.h) return this.oob.bottom;
    return this.tiles[row * this.w + col]!;
  }
  set(col: number, row: number, v: number): void {
    this.tiles[row * this.w + col] = v;
  }
}

export function tileOfPx(v: number): number {
  return Math.floor(v / T.tile);
}

/** A single 40 x 9 chunk as a stand-alone grid: solid above and left/right, open void below the floor row. */
export class ChunkGrid implements TileGrid {
  constructor(readonly tiles: Uint8Array) {}
  get(col: number, row: number): number {
    if (row < 0 || col < 0 || col >= T.chunkW) return Tile.SOLID;
    if (row >= T.chunkH) return Tile.EMPTY;
    return this.tiles[row * T.chunkW + col]!;
  }
}
