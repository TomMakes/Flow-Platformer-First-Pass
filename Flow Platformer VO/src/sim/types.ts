export type Dir = -1 | 0 | 1;

export type Input = { dir: Dir; jump: boolean }; // jump = button held this frame

export type PlayerState = {
  x: number; y: number; // top-left of the hitbox, pixels
  vx: number; vy: number;
  grounded: boolean;
  wallDir: Dir; // side of a touching wall while airborne
  coyote: number; // frames left to jump after leaving ground
  buffer: number; // frames a jump press stays queued
  jumpHeld: boolean; // last frame's jump input, for edge detection
  wallLock: number; // frames of ignored dir input after a wall jump
  bumperCooldown: number;
};

export const Tile = {
  EMPTY: 0,
  SOLID: 1,
  ONEWAY: 2,
  MUD: 3,
  BUMPER: 4,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

/** Anything the physics can collide with. Coordinates are in tiles. */
export interface Grid {
  get(tx: number, ty: number): number;
}

export type ChunkScore = {
  T0: number; // clean run length in frames
  pFall: number; // 1 - product over manoeuvres of (1 - fall rate)
  expectedFrames: number; // T0 + sum over manoeuvres of mean time loss in non-fall trials
  flow: number; // T0 / expectedFrames
  D: number; // 1 - (1 - pFall) * flow
};

export type Chunk = {
  seed: number;
  intensity: number; // generator input, 0..1
  tiles: Uint8Array; // 40 * 9, row-major
  score: ChunkScore; // from the scorer
  run?: Uint8Array; // clean-run inputs, one code per frame (see encodeInput)
  n?: number; // sequence number within the session's generation stream
  epoch?: number; // generation epoch the chunk belongs to
};

export const encodeInput = (i: Input): number => (i.dir + 1) + (i.jump ? 3 : 0);
export const decodeInput = (c: number): Input => ({ dir: ((c % 3) - 1) as Dir, jump: c >= 3 });
