import { T } from '../tuning';
import { type ChunkScore } from '../sim/types';
import { ChunkGrid } from '../sim/grid';
import { mulberry32, hashSeed } from '../sim/rng';
import { chunkField } from './field';
import { type CleanRun } from './bot';
import { manoeuvres, jitterInputs, trialManoeuvre } from './replay';
export { manoeuvres, jitterInputs };

const S = T.scorer;

export function scoreChunk(chunk: { seed: number; tiles: Uint8Array }, run: CleanRun): ChunkScore {
  const grid = new ChunkGrid(chunk.tiles);
  const field = chunkField(grid);
  const fieldOf = (s: { x: number; y: number }) => field.sample(s.x + T.playerW / 2, s.y + T.playerH / 2);
  const r = mulberry32(hashSeed(chunk.seed, 0x5c0e));
  const T0 = run.frames;
  let survive = 1;
  let lossSum = 0;

  for (const m of manoeuvres(run)) {
    const target = fieldOf(run.trace[m.b]) + S.successTiles;
    const clean = m.b - m.a;
    let falls = 0, trials = 0, loss = 0, nonFall = 0;
    for (const J of S.jitterLevels) {
      for (let t = 0; t < S.trialsPerLevel; t++) {
        trials++;
        const ins = jitterInputs(run.inputs, m.a, m.b, J, r);
        const result = trialManoeuvre(grid, fieldOf, run.trace[m.a], ins, target, clean);
        if (result.kind === 'fall') falls++;
        else { nonFall++; loss += result.loss; }
      }
    }
    survive *= 1 - falls / trials;
    if (nonFall > 0) lossSum += loss / nonFall;
  }

  const pFall = 1 - survive;
  const expectedFrames = T0 + lossSum;
  const flow = T0 / expectedFrames;
  const D = 1 - (1 - pFall) * flow;
  return { T0, pFall, expectedFrames, flow, D };
}
