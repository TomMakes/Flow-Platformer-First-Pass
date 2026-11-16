// Web worker shell: generate, solve, score, post. All logic lives in ChunkProducer.
// This is the one file in gen/ that reads a clock, and only for the HUD timing stat; it never feeds
// back into generation.
import { ChunkProducer } from './pipeline';

type InMsg = { type: 'init'; seed: number } | { type: 'state'; s: number; binCounts: number[] };

const ctx = self as unknown as {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<InMsg>) => void) | null;
};

const producer = new ChunkProducer(1);
let running = false;
let emaMs = 0;
let lastStats = 0;

function loop(): void {
  const t0 = self.performance.now();
  const chunk = producer.produce();
  const dt = self.performance.now() - t0;
  emaMs = emaMs === 0 ? dt : emaMs * 0.9 + dt * 0.1;
  if (chunk) {
    const transfer: Transferable[] = [chunk.tiles.buffer as ArrayBuffer];
    if (chunk.ghost) transfer.push(chunk.ghost.buffer as ArrayBuffer);
    ctx.postMessage({ type: 'chunk', chunk }, transfer);
  }
  if (t0 - lastStats >= 1000) {
    lastStats = t0;
    ctx.postMessage({ type: 'stats', solved: producer.solved, discarded: producer.discarded, msPerChunk: emaMs });
  }
  setTimeout(loop, 0); // yield so incoming messages are handled
}

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') producer.reset(m.seed);
  else producer.setState(m.s, m.binCounts);
  if (!running) {
    running = true;
    loop();
  }
};
