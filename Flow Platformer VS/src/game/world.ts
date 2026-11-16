import { T } from '../tuning';
import type { TileGrid } from '../sim/grid';
import { Tile, type Chunk } from '../sim/types';

const SW = T.segW;
const LANE_ROWS = T.chunkH; // 9
const SOLID_ROWS = T.lane2FloorRow + 1; // rows 0..26 are stored per segment

export type Segment = {
  index: number;
  chunks: [Chunk, Chunk, Chunk];
  tiles: Uint8Array; // SW * 27, row-major
};

/** Floor row of lane L, in world rows. Lane L's floor is lane L+1's ceiling. */
export const laneFloorRow = (lane: number) => lane * LANE_ROWS + (LANE_ROWS - 1);

/** The world grid: a row of segments, 31 rows tall, growing to the right. */
export class World implements TileGrid {
  readonly segments = new Map<number, Segment>();
  nextIndex = 0;

  /** Stack three chunks, add ascent gates in lanes 1 and 2, and append the segment. */
  addSegment(chunks: [Chunk, Chunk, Chunk]): Segment {
    const tiles = new Uint8Array(SW * SOLID_ROWS);
    for (let lane = 0; lane < 3; lane++) {
      const src = chunks[lane]!.tiles;
      for (let r = 0; r < LANE_ROWS; r++) {
        for (let c = 0; c < SW; c++) tiles[(lane * LANE_ROWS + r) * SW + c] = src[r * T.chunkW + c]!;
      }
    }
    for (let lane = 1; lane <= 2; lane++) {
      const ceil = laneFloorRow(lane - 1);
      for (const c of T.gateOnewayCols) tiles[ceil * SW + c] = Tile.ONEWAY;
      for (let k = 1; k <= T.gateWallLen; k++) tiles[(ceil + k) * SW + T.gateWallCol] = Tile.SOLID;
    }
    const seg: Segment = { index: this.nextIndex++, chunks, tiles };
    this.segments.set(seg.index, seg);
    return seg;
  }

  segmentAt(col: number): Segment | undefined {
    return this.segments.get(Math.floor(col / SW));
  }

  discardBefore(index: number): void {
    for (const k of this.segments.keys()) if (k < index) this.segments.delete(k);
  }

  get(col: number, row: number): number {
    if (row < 0 || col < 0 || row >= T.worldRows) return Tile.SOLID;
    const seg = this.segments.get(Math.floor(col / SW));
    if (!seg) return Tile.SOLID;
    const lc = col - seg.index * SW;
    if (row < SOLID_ROWS) return seg.tiles[row * SW + lc]!;
    if (row < T.solidRow) return seg.tiles[(SOLID_ROWS - 1) * SW + lc] === Tile.EMPTY ? Tile.EMPTY : Tile.SOLID;
    return Tile.SOLID;
  }

  /** Lane (0..2) for a world row, or 3 for the pit rows. */
  static laneOfRow(row: number): number {
    return row >= SOLID_ROWS ? 3 : Math.floor(row / LANE_ROWS);
  }
}

/** Floor colour for a lane's floor row, from the difficulty of that lane's chunk (green easy to red hard). */
export function floorTint(world: World, col: number, row: number): string | null {
  const lane = (row + 1) / LANE_ROWS - 1; // floor rows are 8, 17, 26
  if (!Number.isInteger(lane) || lane < 0 || lane > 2) return null;
  const seg = world.segments.get(Math.floor(col / SW));
  if (!seg) return null;
  const D = seg.chunks[lane]!.score.D;
  const hue = 130 - 130 * Math.min(1, Math.max(0, D));
  return `hsl(${hue.toFixed(0)}, 45%, 38%)`;
}
