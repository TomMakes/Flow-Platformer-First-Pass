import { T } from '../tuning';
import { isSolid, type TileGrid } from './grid';
import { Tile, type Input, type PlayerState } from './types';

const TS = T.tile;
const W = T.playerW;
const H = T.playerH;
const EPS = 1e-4;

export function makePlayer(x: number, y: number): PlayerState {
  return {
    x, y, vx: 0, vy: 0, grounded: false, wallDir: 0,
    coyote: 0, buffer: 0, jumpHeld: false, wallLock: 0, bumperCooldown: 0,
  };
}

/** A player standing on a floor with its feet at `feetY`. */
export function makeStanding(x: number, feetY: number): PlayerState {
  return { ...makePlayer(x, feetY - H), grounded: true, coyote: T.coyote };
}

function approach(v: number, target: number, amt: number): number {
  if (v < target) return Math.min(v + amt, target);
  if (v > target) return Math.max(v - amt, target);
  return v;
}

function overlapsSolid(grid: TileGrid, c0: number, c1: number, r0: number, r1: number): boolean {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (isSolid(grid.get(c, r))) return true;
  return false;
}

/** Pure: returns a new state, never mutates `s`. One call = 1/60 s. */
export function step(s: PlayerState, input: Input, grid: TileGrid): PlayerState {
  let { x, y, vx, vy, grounded, wallDir, coyote, buffer, wallLock, bumperCooldown } = s;
  const dir = input.dir;
  const prevJumpHeld = s.jumpHeld;

  // 1. jump press
  if (input.jump && !prevJumpHeld) buffer = T.buffer;

  // 2. horizontal acceleration / friction
  let maxSpeed: number = T.maxRun;
  if (grounded) {
    const under = grid.get(Math.floor((x + W / 2) / TS), Math.floor((y + H + 1) / TS));
    if (under === Tile.MUD) maxSpeed *= T.mudFactor;
  }
  if (wallLock <= 0) {
    if (dir !== 0) vx = approach(vx, dir * maxSpeed, T.accel);
    else if (grounded) vx = approach(vx, 0, T.friction);
  }

  // 3. buffered jump: ground/coyote first, then wall
  let newLock = false;
  if (buffer > 0) {
    if (grounded || coyote > 0) {
      vy = T.jumpV;
      grounded = false;
      coyote = 0;
      buffer = 0;
    } else if (wallDir !== 0) {
      vy = T.wallJumpVy;
      vx = -wallDir * T.wallJumpVx;
      wallLock = T.wallLock;
      newLock = true;
      buffer = 0;
      wallDir = 0;
    }
  }

  // 4. variable jump height
  if (!input.jump && prevJumpHeld && vy < 0) vy *= T.jumpCut;

  // 5. gravity and wall slide
  vy = Math.min(vy + T.gravity, T.maxFall);
  if (wallDir !== 0 && !grounded && dir === wallDir && vy > T.wallSlideCap) vy = T.wallSlideCap;

  // 6a. move X
  x += vx;
  {
    const r0 = Math.floor(y / TS);
    const r1 = Math.floor((y + H - EPS) / TS);
    if (vx > 0) {
      const c = Math.floor((x + W - EPS) / TS);
      if (overlapsSolid(grid, c, c, r0, r1)) { x = c * TS - W; vx = 0; }
    } else if (vx < 0) {
      const c = Math.floor(x / TS);
      if (overlapsSolid(grid, c, c, r0, r1)) { x = (c + 1) * TS; vx = 0; }
    }
  }

  // 6b. move Y
  let landed = false;
  {
    const prevBottom = y + H;
    y += vy;
    const c0 = Math.floor(x / TS);
    const c1 = Math.floor((x + W - EPS) / TS);
    if (vy > 0) {
      const rb = Math.floor((y + H - EPS) / TS);
      for (let c = c0; c <= c1; c++) {
        const t = grid.get(c, rb);
        if (isSolid(t) || (t === Tile.ONEWAY && prevBottom <= rb * TS + EPS)) {
          y = rb * TS - H; vy = 0; landed = true; break;
        }
      }
    } else if (vy < 0) {
      const rt = Math.floor(y / TS);
      if (overlapsSolid(grid, c0, c1, rt, rt)) { y = (rt + 1) * TS; vy = 0; }
    }
  }
  grounded = landed;

  // wall contact (airborne only)
  wallDir = 0;
  if (!grounded) {
    const r0 = Math.floor(y / TS);
    const r1 = Math.floor((y + H - EPS) / TS);
    const cl = Math.floor((x - 0.5) / TS);
    const cr = Math.floor((x + W + 0.5) / TS);
    const left = overlapsSolid(grid, cl, cl, r0, r1);
    const right = overlapsSolid(grid, cr, cr, r0, r1);
    if (left && right) wallDir = dir === 1 ? 1 : -1;
    else if (left) wallDir = -1;
    else if (right) wallDir = 1;
  }

  // 7. tile effects: bumper
  let newBump = false;
  if (bumperCooldown <= 0) {
    const c0 = Math.floor(x / TS), c1 = Math.floor((x + W - EPS) / TS);
    const r0 = Math.floor(y / TS), r1 = Math.floor((y + H - EPS) / TS);
    outer: for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (grid.get(c, r) === Tile.BUMPER) {
          vx = T.bumperVx; vy = T.bumperVy;
          bumperCooldown = T.bumperCooldown; newBump = true;
          grounded = false; wallDir = 0;
          break outer;
        }
      }
    }
  }

  // 8. timers
  buffer = Math.max(0, buffer - 1);
  coyote = grounded ? T.coyote : Math.max(0, coyote - 1);
  if (!newLock) wallLock = Math.max(0, wallLock - 1);
  if (!newBump) bumperCooldown = Math.max(0, bumperCooldown - 1);

  return { x, y, vx, vy, grounded, wallDir, coyote, buffer, jumpHeld: input.jump, wallLock, bumperCooldown };
}
