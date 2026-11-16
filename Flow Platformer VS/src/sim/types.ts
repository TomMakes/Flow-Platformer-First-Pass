export type Input = { dir: -1 | 0 | 1; jump: boolean };

export type PlayerState = {
  x: number;
  y: number; // top-left of the hitbox, pixels
  vx: number;
  vy: number;
  grounded: boolean;
  wallDir: -1 | 0 | 1;
  coyote: number;
  buffer: number;
  jumpHeld: boolean;
  wallLock: number;
  bumperCooldown: number;
};

export const Tile = {
  EMPTY: 0,
  SOLID: 1,
  ONEWAY: 2,
  MUD: 3,
  BUMPER: 4,
} as const;

export type ChunkScore = {
  T0: number;
  pFall: number;
  expectedFrames: number;
  flow: number;
  D: number;
};

export type Chunk = {
  seed: number;
  intensity: number;
  tiles: Uint8Array; // 40 * 9, row-major
  score: ChunkScore;
  ghost?: Float32Array; // clean-run centre positions (x,y per frame), for the G overlay
};

export type CleanRun = {
  inputs: Input[];
  trace: PlayerState[];
  frames: number;
};
