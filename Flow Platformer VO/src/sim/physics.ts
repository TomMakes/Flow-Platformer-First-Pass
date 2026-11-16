import { T } from '../tuning';
import { Tile, type Dir, type Grid, type Input, type PlayerState } from './types';
import { boxHits, isSolid, tileOf } from './grid';

const TS = T.tile;
const W = T.playerW;
const H = T.playerH;
const EPS = 1e-6;

export function makePlayer(x: number, y: number, vx = 0, grounded = true): PlayerState {
  return {
    x, y, vx, vy: 0, grounded, wallDir: 0,
    coyote: grounded ? T.coyote : 0, buffer: 0, jumpHeld: false, wallLock: 0, bumperCooldown: 0,
  };
}

/** Player standing on the floor tile row `floorRow`, centred at tile column `col`. */
export function playerOnFloor(col: number, floorRow: number, vx = 0): PlayerState {
  return makePlayer(col * TS - W / 2, floorRow * TS - H, vx, true);
}

const approach = (v: number, target: number, rate: number): number =>
  v < target ? Math.min(v + rate, target) : Math.max(v - rate, target);

/** Advance one fixed 1/60 s frame. Pure: never mutates `s`. */
export function step(s: PlayerState, input: Input, grid: Grid): PlayerState {
  let { x, y, vx, vy, coyote, buffer, wallLock, bumperCooldown } = s;
  let grounded = s.grounded;

  // 1. Jump press -> buffer.
  if (input.jump && !s.jumpHeld) buffer = T.jumpBuffer;

  // 2. Horizontal acceleration / friction.
  const dir: Dir = wallLock > 0 ? 0 : input.dir;
  const onMud = s.grounded && grid.get(tileOf(x + W / 2), tileOf(y + H + 0.5)) === Tile.MUD;
  const maxRun = onMud ? T.maxRun * T.mudFactor : T.maxRun;
  if (dir !== 0) vx = approach(vx, dir * maxRun, T.accel);
  else if (s.grounded) vx = approach(vx, 0, T.friction);

  // 3. Jumps.
  if (buffer > 0) {
    if (s.grounded || coyote > 0) {
      vy = T.jumpV; buffer = 0; coyote = 0; grounded = false;
    } else if (s.wallDir !== 0) {
      vx = -s.wallDir * T.wallJumpVx; vy = T.wallJumpVy;
      wallLock = T.wallLock; buffer = 0;
    }
  }

  // 4. Variable jump height: cut once on release.
  if (!input.jump && s.jumpHeld && vy < 0) vy *= T.jumpCut;

  // 5. Gravity and wall slide.
  vy = Math.min(vy + T.gravity, T.maxFall);
  if (!s.grounded && s.wallDir !== 0 && input.dir === s.wallDir && vy > T.wallSlideCap) vy = T.wallSlideCap;

  // 6a. Move on X, resolve against solids.
  x += vx;
  if (vx !== 0 && boxHits(grid, x, y, W, H, isSolid)) {
    if (vx > 0) x = tileOf(x + W - EPS) * TS - W;
    else x = (tileOf(x) + 1) * TS;
    vx = 0;
  }

  // 6b. Move on Y, resolve against solids and one-way tops.
  const oldBottom = y + H;
  y += vy;
  if (vy > 0) {
    const newBottom = y + H;
    let landRow = -1;
    if (boxHits(grid, x, y, W, H, isSolid)) landRow = tileOf(newBottom - EPS);
    else {
      const row = tileOf(newBottom - EPS);
      if (row * TS >= oldBottom - EPS && boxHits(grid, x, row * TS, W, 1, (t) => t === Tile.ONEWAY)) landRow = row;
    }
    if (landRow >= 0) { y = landRow * TS - H; vy = 0; }
  } else if (vy < 0 && boxHits(grid, x, y, W, H, isSolid)) {
    y = (tileOf(y) + 1) * TS; vy = 0;
  }

  // 6c. Contacts.
  grounded = false;
  if (vy >= 0) {
    const feet = y + H;
    const row = tileOf(feet + 0.5);
    const aligned = Math.abs(feet - row * TS) < 0.01;
    if (aligned && boxHits(grid, x, row * TS, W, 1, (t) => isSolid(t) || t === Tile.ONEWAY)) grounded = true;
  }
  let wallDir: Dir = 0;
  if (!grounded) {
    if (boxHits(grid, x + W, y, 1, H, isSolid)) wallDir = 1;
    else if (boxHits(grid, x - 1, y, 1, H, isSolid)) wallDir = -1;
  }
  if (grounded) coyote = T.coyote;

  // 7. Tile effects: bumper overlap (mud is read in step 2 from ground contact).
  if (bumperCooldown === 0 && boxHits(grid, x, y, W, H, (t) => t === Tile.BUMPER)) {
    vx = T.bumperVx; vy = T.bumperVy; bumperCooldown = T.bumperCooldown; grounded = false; wallDir = 0;
  }

  // 8. Timers.
  if (buffer > 0) buffer--;
  if (wallLock > 0) wallLock--;
  if (bumperCooldown > 0) bumperCooldown--;
  if (!grounded && coyote > 0) coyote--;

  return { x, y, vx, vy, grounded, wallDir, coyote, buffer, jumpHeld: input.jump, wallLock, bumperCooldown };
}
