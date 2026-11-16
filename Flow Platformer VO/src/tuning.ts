// Every tunable constant in the build plan lives here.
// Units: pixels, pixels per frame, frames (1 frame = 1/60 s), tiles where noted.

export const T = {
  // ---- Simulation -------------------------------------------------------
  fps: 60,
  maxStepsPerRender: 5,

  // ---- Geometry ---------------------------------------------------------
  tile: 32,
  playerW: 20,
  playerH: 40,

  // ---- Movement ---------------------------------------------------------
  maxRun: 6,
  accel: 0.6, // ground and air: same value gives full air control
  friction: 0.8, // only when grounded and no direction held
  gravity: 0.6,
  maxFall: 14,
  jumpV: -12,
  jumpCut: 0.5,
  coyote: 6,
  jumpBuffer: 6,
  wallSlideCap: 2.5,
  wallJumpVx: 5.5,
  wallJumpVy: -11,
  wallLock: 4,
  mudFactor: 0.5,
  bumperVx: -7,
  bumperVy: -5,
  bumperCooldown: 30,

  // ---- World ------------------------------------------------------------
  worldRows: 31,
  laneRows: 9, // 8 interior + 1 floor
  lanes: 3,
  pitTopRow: 27,
  pitRows: 2, // open rows under a lane-2 hole: with the hole row itself the pit is 3 tiles deep,
  // less than a full jump, so a plain jump gets out (rows below are solid)
  segmentsKeptBehind: 2,
  assembleAheadTiles: 30,
  gateHangLength: 5,
  gateCol: 3, // hanging wall column; ONEWAY ceiling tiles sit at columns 1 and 2
  fallDriftTiles: 6, // assembly rule
  startLane: 1,
  startCol: 6,

  // ---- Chunk ------------------------------------------------------------
  chunkW: 40,
  chunkH: 9,
  chunkFloorRow: 8,
  chunkClearCols: 4, // first and last N columns are flat and clear
  placeStopCol: 35,
  firstObstacleCol: 6, // plan said 4; a hole at 4-5 cannot be jumped without hitting the gate wall

  // ---- Generator (value at intensity 0, value at intensity 1) ----------
  gen: {
    holeW: [2, 6] as const,
    holeRange: [2, 6] as const,
    wallH: [1, 6] as const,
    wallRange: [1, 6] as const,
    mudLen: [2, 6] as const,
    mudRange: [2, 6] as const,
    spacing: [8, 2] as const,
    spacingRange: [2, 8] as const,
    trapShare: [0.2, 0.5] as const,
    modifierStart: 0.4, // modifier probability = intensity - this
    sizeJitter: 1, // +/- tiles
    raisedBumper: [2, 3] as const, // tiles above the floor
  },

  // ---- Bot --------------------------------------------------------------
  bot: {
    startCol: 1.5,
    stepFrames: 4,
    beam: 40,
    stepLimit: 150,
    goalCol: 38,
    bucketPos: 16, // plan said 8; 8 pruned too many wall-climb states
    bucketVel: 4, // plan said 2
    centreRange: 20, // frames each input change of the clean run is probed either side when centring
    centreLoss: 2, // frames of time loss still counted as a working timing while centring
  },

  // ---- Scorer -----------------------------------------------------------
  scorer: {
    minManoeuvre: 10,
    jitterLevels: [3, 6, 9, 12],
    trialsPerLevel: 4,
    recoveryFrames: 30,
    stallPenalty: 60,
    successTiles: 1,
  },

  // ---- Tracker ----------------------------------------------------------
  tracker: {
    startS: 0.25,
    startCols: [0, 4] as const,
    endCol: 38,
    cleanRatio: 0.8,
    roughRatio: 0.55,
    roughValue: 0.5,
    eloScale: 0.12,
    kEarly: 0.3,
    kEarlyChunks: 4,
    kLate: 0.12,
  },

  // ---- Director / bank --------------------------------------------------
  director: {
    laneOffset: 0.15,
    targetMax: 0.95,
    bankMax: 150,
    bins: 10,
    binWindow: 0.3,
    biasRate: 0.1,
    selectCandidates: 24, // nearest chunks per lane considered when picking a segment
    startupMin: 12,
    startupNear: 3,
    startupNearDist: 0.1,
    // Deterministic generation epochs (see README): chunks generated per epoch.
    epoch0Chunks: 36,
    epochChunks: 12,
    fixedIntensities: [0.7, 0.4, 0.1] as const, // milestone-2 mode
  },

  // ---- Render -----------------------------------------------------------
  render: {
    width: 1280,
    height: 720,
    playerScreenX: 1 / 3,
    camSmoothY: 0.1,
    ghostPad: 30, // frames the ghost rests at the goal before looping
  },
} as const;

export type Tuning = typeof T;
