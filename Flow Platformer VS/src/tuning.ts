// Every constant in the build plan lives here. All values are starting points.
export const T = {
  // --- geometry (section 3, 4) ---
  tile: 32,
  playerW: 20,
  playerH: 40,
  chunkW: 40,
  chunkH: 9,
  segW: 40,
  worldRows: 31,
  laneCount: 3,
  lane2FloorRow: 26,
  pitRows: 3,
  solidRow: 30,

  // --- physics (section 3), px/frame and frames ---
  maxRun: 6,
  accel: 0.6,
  friction: 0.8,
  gravity: 0.6,
  maxFall: 14,
  jumpV: -12,
  jumpCut: 0.5,
  coyote: 6,
  buffer: 6,
  wallSlideCap: 2.5,
  wallJumpVx: 5.5,
  wallJumpVy: -11,
  wallLock: 4,
  mudFactor: 0.5,
  bumperVx: -7,
  bumperVy: -5,
  bumperCooldown: 30,
  dt: 1 / 60,
  maxStepsPerFrame: 5,

  // --- ascent gate (section 4) ---
  gateOnewayCols: [1, 2] as number[],
  gateWallCol: 3,
  gateWallLen: 5,
  safeCols: 4, // flat clear columns at both ends of a chunk
  goalCol: 38,
  startCol: 1.5,

  // --- assembly rule (section 4) ---
  fallDrift: 6,

  // --- generator (section 5) ---
  gen: {
    holeW: [2, 6] as [number, number],
    wallH: [1, 6] as [number, number],
    wallWidth: [1, 2] as [number, number],
    mudLen: [2, 6] as [number, number],
    spacing: [8, 2] as [number, number], // at intensity 0 -> 1
    trapShare: [0.2, 0.5] as [number, number],
    modifierThreshold: 0.4,
    sizeJitter: 1,
    cursorStart: 4,
    cursorEnd: 35,
    mudRunup: 3,
  },

  // --- bot (section 6) ---
  bot: {
    stepFrames: 4,
    beamWidth: 40,
    stepLimit: 150,
    bucketPos: 8,
    bucketVel: 2,
  },

  // --- scorer (section 7) ---
  score: {
    jitterLevels: [2, 4, 6, 8],
    trialsPerLevel: 4,
    recoveryFrames: 30,
    stallPenalty: 60,
    minManoeuvre: 10,
    successTiles: 1,
  },

  // --- tracker (section 8) ---
  tracker: {
    startS: 0.25,
    kEarly: 0.3,
    kLate: 0.12,
    earlyCount: 4,
    scale: 0.12,
    cleanRatio: 0.8,
    roughRatio: 0.55,
    roughOutcome: 0.5,
    laneOffset: 0.15,
    targetMax: 0.95,
  },

  // --- runtime (section 9) ---
  runtime: {
    binCount: 10,
    binWindow: 0.3,
    biasGain: 0.1,
    bankMax: 150,
    startBankMin: 12,
    startNearCount: 3,
    startNearTol: 0.1,
    assembleAhead: 30,
    keepBehindSegments: 2,
    canvasW: 1280,
    canvasH: 720,
    fixedIntensities: [0.7, 0.4, 0.1] as number[],
    cameraSmooth: 0.12,
  },
} as const;
