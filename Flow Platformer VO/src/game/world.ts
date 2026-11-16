import { T } from '../tuning';
import { Tile, type Chunk, type Grid } from '../sim/types';
import { holesOf } from '../gen/generator';

const CW = T.chunkW, ROWS = T.worldRows, LR = T.laneRows;

export type Segment = { index: number; tiles: Uint8Array; chunks: [Chunk, Chunk, Chunk] };

export const laneTop = (lane: number): number => lane * LR; // first interior row
export const laneFloor = (lane: number): number => lane * LR + T.chunkFloorRow;
/** Lane index of a world row: 0..2, or 3 for the pit under lane 2. */
export const laneOfRow = (row: number): number => Math.min(3, Math.max(0, Math.floor(row / LR)));

/** Reject a hole in the upper lane with a hole below it from its first column to six past its last. */
const holeCache = new WeakMap<Uint8Array, ReturnType<typeof holesOf>>();
const holes = (t: Uint8Array) => { let h = holeCache.get(t); if (!h) { h = holesOf(t); holeCache.set(t, h); } return h; };

export function assemblyOk(upper: Uint8Array, lower: Uint8Array): boolean {
  const below = holes(lower);
  for (const h of holes(upper)) {
    const a = h.a, b = h.b + T.fallDriftTiles;
    if (below.some((q) => q.a <= b && q.b >= a)) return false;
  }
  return true;
}

/** Stack three chunks into a 40 x 31 segment and add the ascent gates and lane-2 pits. */
export function assembleSegment(chunks: [Chunk, Chunk, Chunk]): Uint8Array {
  const t = new Uint8Array(CW * ROWS);
  const set = (x: number, y: number, v: number) => { t[y * CW + x] = v; };
  chunks.forEach((c, lane) => {
    for (let r = 0; r < T.chunkH; r++) for (let x = 0; x < CW; x++) set(x, laneTop(lane) + r, c.tiles[r * CW + x]);
  });
  const floor2 = laneFloor(2);
  for (let x = 0; x < CW; x++) {
    const hole = t[floor2 * CW + x] === Tile.EMPTY;
    for (let y = T.pitTopRow; y < ROWS; y++) set(x, y, hole && y < T.pitTopRow + T.pitRows ? Tile.EMPTY : Tile.SOLID);
  }
  // Ascent gates in lanes 1 and 2. Lane 0 gets the hanging wall too (nothing above it to
  // climb to), so every lane has the same geometry the bot solved the chunk against.
  for (const lane of [0, 1, 2]) {
    if (lane > 0) {
      const ceiling = laneTop(lane) - 1;
      for (let x = T.gateCol - 2; x < T.gateCol; x++) set(x, ceiling, Tile.ONEWAY);
    }
    for (let y = laneTop(lane); y < laneTop(lane) + T.gateHangLength; y++) set(T.gateCol, y, Tile.SOLID);
  }
  return t;
}

/** The endless world: a row of segments; solid above row 0, below the bottom, and where no segment exists. */
export class World implements Grid {
  segs = new Map<number, Segment>();
  next = 0; // index of the next segment to assemble

  add(chunks: [Chunk, Chunk, Chunk]): Segment {
    const seg: Segment = { index: this.next++, tiles: assembleSegment(chunks), chunks };
    this.segs.set(seg.index, seg);
    return seg;
  }

  get(tx: number, ty: number): number {
    if (ty < 0 || ty >= ROWS) return Tile.SOLID;
    const si = Math.floor(tx / CW);
    const seg = this.segs.get(si);
    if (!seg) return Tile.SOLID;
    return seg.tiles[ty * CW + (tx - si * CW)];
  }

  /** Drop segments more than `keep` behind segment `current`. */
  discardBehind(current: number, keep = T.segmentsKeptBehind): void {
    for (const k of this.segs.keys()) if (k < current - keep) this.segs.delete(k);
  }
}
