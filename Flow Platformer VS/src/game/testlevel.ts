import { ArrayGrid } from '../sim/grid';
import { Tile } from '../sim/types';

export const TEST_FLOOR_ROW = 14;

/** Milestone-1 hand-written level: hole, tall wall, mud, bumper, ONEWAY ledge, very tall wall. */
export function makeTestLevel(): ArrayGrid {
  const w = 120, h = 20;
  const g = new ArrayGrid(w, h, new Uint8Array(w * h));
  for (let c = 0; c < w; c++) for (let r = TEST_FLOOR_ROW; r < h; r++) g.set(c, r, Tile.SOLID);
  // six-tile hole
  for (let c = 14; c < 20; c++) for (let r = TEST_FLOOR_ROW; r < h; r++) g.set(c, r, Tile.EMPTY);
  // six-tile wall
  for (let r = TEST_FLOOR_ROW - 6; r < TEST_FLOOR_ROW; r++) g.set(26, r, Tile.SOLID);
  // mud
  for (let c = 34; c < 40; c++) g.set(c, TEST_FLOOR_ROW, Tile.MUD);
  // bumper on the floor
  g.set(46, TEST_FLOOR_ROW - 1, Tile.BUMPER);
  // one-way ledge
  for (let c = 54; c < 59; c++) g.set(c, 10, Tile.ONEWAY);
  // very tall wall for wall-climbing
  for (let r = 0; r < TEST_FLOOR_ROW; r++) g.set(70, r, Tile.SOLID);
  // end wall
  for (let r = 0; r < TEST_FLOOR_ROW; r++) g.set(w - 1, r, Tile.SOLID);
  return g;
}
