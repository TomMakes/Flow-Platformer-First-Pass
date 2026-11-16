/// <reference lib="webworker" />
// Generation worker: generate, solve, score, post results. All timing lives on the main thread.
import { GenCore, type Snapshot } from './genCore';

declare const self: DedicatedWorkerGlobalScope;

let core: GenCore | null = null;
const queue: Snapshot[] = [];
let running = false;

function pump(): void {
  if (running || !core || queue.length === 0) return;
  running = true;
  const it = core.epoch(queue.shift()!);
  const next = () => {
    const r = it.next();
    if (r.done) { running = false; pump(); return; }
    const chunk = r.value;
    const transfer: Transferable[] = [chunk.tiles.buffer];
    if (chunk.run) transfer.push(chunk.run.buffer);
    self.postMessage({ type: 'chunk', chunk }, transfer);
    self.postMessage({ type: 'stats', solved: core!.produced, discarded: core!.discarded });
    setTimeout(next, 0); // yield so incoming messages are handled
  };
  next();
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') { core = new GenCore(m.seed); queue.length = 0; }
  else if (m.type === 'state') { queue.push({ epoch: m.epoch, s: m.s, binCounts: m.binCounts }); pump(); }
};
