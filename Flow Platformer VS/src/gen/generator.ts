import { T } from '../tuning';
import { mulberry32, randInt, type Rng } from '../sim/rng';
import { Tile, type Chunk, type ChunkScore } from '../sim/types';

const CW = T.chunkW;
const FLOOR = T.chunkH - 1; // chunk row 8
const G = T.gen;

export const EMPTY_SCORE: ChunkScore = { T0: 0, pFall: 0, expectedFrames: 0, flow: 1, D: 0 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function flatTiles(): Uint8Array {
  const tiles = new Uint8Array(CW * T.chunkH);
  for (let c = 0; c < CW; c++) tiles[FLOOR * CW + c] = Tile.SOLID;
  return tiles;
}

export function flatChunk(): Chunk {
  return { seed: 0, intensity: 0, tiles: flatTiles(), score: { ...EMPTY_SCORE } };
}

function sized(rng: Rng, range: [number, number], i: number): number {
  const base = Math.round(lerp(range[0], range[1], i));
  return clamp(base + randInt(rng, -G.sizeJitter, G.sizeJitter), range[0], range[1]);
}

/**
 * Build one chunk from a seed and an intensity hint (0..1). Pure and deterministic.
 * The chunk's real difficulty is whatever the bot/scorer measures afterwards.
 */
export function generateChunk(seed: number, intensity: number): Chunk {
  const rng = mulberry32(seed);
  const i = clamp(intensity, 0, 1);
  const tiles = flatTiles();
  const set = (c: number, r: number, v: number) => { tiles[r * CW + c] = v; };
  const modP = Math.max(0, i - G.modifierThreshold);
  const trapP = lerp(G.trapShare[0], G.trapShare[1], i);

  let cursor = G.cursorStart;
  let lastEnd = G.cursorStart;
  while (cursor <= G.cursorEnd) {
    const trap = rng() < trapP;
    const kind = trap ? (rng() < 0.5 ? 'mud' : 'bumper') : rng() < 0.5 ? 'hole' : 'wall';
    let width = 1;
    if (kind === 'hole') width = sized(rng, G.holeW, i);
    else if (kind === 'wall') width = randInt(rng, G.wallWidth[0], G.wallWidth[1]);
    else if (kind === 'mud') width = sized(rng, G.mudLen, i);
    if (cursor + width - 1 > G.cursorEnd) break;

    if (kind === 'hole') {
      for (let c = cursor; c < cursor + width; c++) set(c, FLOOR, Tile.EMPTY);
    } else if (kind === 'wall') {
      const h = sized(rng, G.wallH, i);
      for (let c = cursor; c < cursor + width; c++) for (let r = FLOOR - h; r < FLOOR; r++) set(c, r, Tile.SOLID);
    } else if (kind === 'mud') {
      for (let c = cursor; c < cursor + width; c++) set(c, FLOOR, Tile.MUD);
    } else {
      // bumper on the floor, or 2 to 3 tiles above it
      const row = rng() < 0.5 ? FLOOR - 1 : FLOOR - 1 - randInt(rng, 2, 3);
      set(cursor, row, Tile.BUMPER);
    }

    // modifiers: a raised bumper over a hole, or mud on the run-up to a hole or wall
    if (modP > 0 && rng() < modP) {
      if (kind === 'hole') {
        set(cursor + (width >> 1), FLOOR - 1 - randInt(rng, 2, 3), Tile.BUMPER);
      } else if (kind === 'wall' && cursor - G.mudRunup >= lastEnd) {
        for (let c = cursor - G.mudRunup; c < cursor; c++) set(c, FLOOR, Tile.MUD);
      }
    }
    if (modP > 0 && kind === 'hole' && cursor - G.mudRunup >= lastEnd && rng() < modP) {
      for (let c = cursor - G.mudRunup; c < cursor; c++) set(c, FLOOR, Tile.MUD);
    }

    lastEnd = cursor + width;
    cursor += width + Math.round(lerp(G.spacing[0], G.spacing[1], i));
  }
  return { seed, intensity: i, tiles, score: { ...EMPTY_SCORE } };
}

/** Inclusive column spans [a, b] of holes in a chunk's floor row. */
export function holeSpans(chunk: Chunk): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start = -1;
  for (let c = 0; c <= CW; c++) {
    const hole = c < CW && chunk.tiles[FLOOR * CW + c] === Tile.EMPTY;
    if (hole && start < 0) start = c;
    if (!hole && start >= 0) { spans.push([start, c - 1]); start = -1; }
  }
  return spans;
}

/**
 * Assembly rule: reject if a hole in the upper lane has a hole in the lane below anywhere from
 * its first column to `fallDrift` columns past its last (an unavoidable double fall).
 */
export function assemblyOk(upper: Chunk, lower: Chunk): boolean {
  const lowerHoles = holeSpans(lower);
  for (const [a, b] of holeSpans(upper)) {
    const end = b + T.fallDrift;
    for (const [la, lb] of lowerHoles) if (la <= end && lb >= a) return false;
  }
  return true;
}
