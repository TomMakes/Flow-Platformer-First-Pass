import { T } from '../tuning';
import { Tile, type Chunk, type ChunkScore } from '../sim/types';
import { mulberry32, randInt, type Rng } from '../sim/rng';

const W = T.chunkW, H = T.chunkH, FLOOR = T.chunkFloorRow;
const G = T.gen;

export const EMPTY_SCORE: ChunkScore = { T0: 0, pFall: 0, expectedFrames: 0, flow: 1, D: 0 };

const lerp = (r: readonly [number, number], t: number) => r[0] + (r[1] - r[0]) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function flatTiles(): Uint8Array {
  const t = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) t[FLOOR * W + x] = Tile.SOLID;
  return t;
}

export function flatChunk(seed = 0): Chunk {
  return { seed, intensity: 0, tiles: flatTiles(), score: { ...EMPTY_SCORE } };
}

type Hole = { a: number; b: number };

/** Columns [a, b] inclusive of every hole in the chunk floor. */
export function holesOf(tiles: Uint8Array, w = W, floor = FLOOR): Hole[] {
  const out: Hole[] = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    const empty = x < w && tiles[floor * w + x] === Tile.EMPTY;
    if (empty && start < 0) start = x;
    if (!empty && start >= 0) { out.push({ a: start, b: x - 1 }); start = -1; }
  }
  return out;
}

/** Build one chunk from a seed and an intensity in [0, 1]. Score is filled in later. */
export function generateChunk(seed: number, intensity: number): Chunk {
  const r: Rng = mulberry32(seed);
  const i = clamp(intensity, 0, 1);
  const tiles = flatTiles();
  const set = (x: number, y: number, t: number) => { tiles[y * W + x] = t; };
  const get = (x: number, y: number) => tiles[y * W + x];
  const jit = () => randInt(r, -G.sizeJitter, G.sizeJitter);
  const size = (base: readonly [number, number], range: readonly [number, number]) =>
    clamp(Math.round(lerp(base, i) + jit()), range[0], range[1]);
  const lastLegal = W - T.chunkClearCols; // obstacles must end before this column
  const modP = i - G.modifierStart;

  let cursor = T.firstObstacleCol;
  while (cursor <= T.placeStopCol) {
    const trap = r() < lerp(G.trapShare, i);
    const kind = trap ? (r() < 0.5 ? 'mud' : 'bumper') : (r() < 0.5 ? 'hole' : 'wall');
    let width = 1;
    if (kind === 'hole') width = size(G.holeW, G.holeRange);
    else if (kind === 'mud') width = size(G.mudLen, G.mudRange);
    else if (kind === 'wall') width = r() < 0.5 ? 1 : 2;
    if (cursor + width > lastLegal) width = lastLegal - cursor;
    if (width < 1 || (kind === 'hole' && width < G.holeRange[0])) break;

    if (kind === 'hole') {
      for (let x = cursor; x < cursor + width; x++) set(x, FLOOR, Tile.EMPTY);
    } else if (kind === 'wall') {
      const h = size(G.wallH, G.wallRange);
      for (let x = cursor; x < cursor + width; x++) for (let y = FLOOR - h; y < FLOOR; y++) set(x, y, Tile.SOLID);
    } else if (kind === 'mud') {
      for (let x = cursor; x < cursor + width; x++) set(x, FLOOR, Tile.MUD);
    } else {
      const raised = r() < 0.5 ? 0 : randInt(r, G.raisedBumper[0], G.raisedBumper[1]);
      set(cursor, raised === 0 ? FLOOR - 1 : FLOOR - raised, Tile.BUMPER);
    }

    // Modifiers on holes and walls.
    if ((kind === 'hole' || kind === 'wall') && modP > 0 && r() < modP) {
      if (kind === 'hole' && r() < 0.5) {
        const bx = cursor + Math.floor(width / 2);
        set(bx, FLOOR - randInt(r, G.raisedBumper[0], G.raisedBumper[1]), Tile.BUMPER);
      } else {
        for (let x = cursor - 2; x < cursor; x++)
          if (x >= T.chunkClearCols && get(x, FLOOR) === Tile.SOLID && get(x, FLOOR - 1) === Tile.EMPTY) set(x, FLOOR, Tile.MUD);
      }
    }

    const spacing = clamp(Math.round(lerp(G.spacing, i) + jit()), G.spacingRange[0], G.spacingRange[1]);
    cursor += width + spacing;
  }
  return { seed, intensity: i, tiles, score: { ...EMPTY_SCORE } };
}
