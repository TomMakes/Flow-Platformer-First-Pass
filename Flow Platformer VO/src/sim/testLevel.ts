import { TextGrid } from './grid';

/** Milestone-1 hand-written level: a 6-wide hole over a pit, a 6-tall wall,
 *  a mud strip, a floor bumper and a ONEWAY ledge. Floor is row 9. */
export function testLevelRows(): string[] {
  const W = 64;
  const rows: string[][] = Array.from({ length: 13 }, () => Array(W).fill('.'));
  const put = (x: number, y: number, c: string) => { rows[y][x] = c; };
  for (let x = 0; x < W; x++) { put(x, 9, '#'); put(x, 10, '#'); put(x, 11, '#'); put(x, 12, '#'); }
  for (let x = 10; x < 16; x++) for (let y = 9; y <= 11; y++) put(x, y, '.'); // hole + pit
  for (let x = 22; x < 24; x++) for (let y = 3; y <= 8; y++) put(x, y, '#'); // 6-tall wall
  for (let x = 30; x < 36; x++) put(x, 9, 'm'); // mud
  put(40, 8, 'b'); // bumper on the floor
  for (let x = 46; x < 51; x++) put(x, 6, '='); // one-way ledge
  return rows.map((r) => r.join(''));
}

export const TEST_FLOOR_ROW = 9;
export const TEST_GOAL_COL = 60;
export const testLevel = (): TextGrid => new TextGrid(testLevelRows());
