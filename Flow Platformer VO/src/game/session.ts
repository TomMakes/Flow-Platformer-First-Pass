import { T } from '../tuning';
import { type Input, type PlayerState } from '../sim/types';
import { step, playerOnFloor } from '../sim/physics';
import { World, laneFloor, type Segment } from './world';
import { Director, FixedDirector, scoredFlat, type ChunkFeed, type Pick } from './director';
import { Tracker } from './tracker';

export type Mode = 'adaptive' | 'fixed';

/** Everything that changes during play, with no DOM. Deterministic given seed, feed and inputs. */
export class Session {
  world = new World();
  tracker = new Tracker();
  player: PlayerState;
  frame = 0;
  director: Director | FixedDirector;
  started = false;
  waiting = false;
  picks = new Map<number, Pick>();
  onAssemble: ((seg: Segment, pick: Pick) => void) | null = null;

  constructor(public seed: number, public mode: Mode, feed: ChunkFeed | null) {
    this.director = mode === 'fixed' || !feed ? new FixedDirector(seed) : new Director(feed, this.tracker.s);
    const flat = [scoredFlat(), scoredFlat(), scoredFlat()] as Pick['chunks'];
    this.world.add(flat);
    this.picks.set(0, { chunks: flat, targets: [0, 0, 0], misses: 0 });
    this.player = playerOnFloor(T.startCol, laneFloor(T.startLane));
  }

  get playerTileX(): number { return (this.player.x + T.playerW / 2) / T.tile; }

  private due(): boolean { return this.world.next * T.chunkW - this.playerTileX <= T.assembleAheadTiles; }

  /** Assemble any due segments; returns false if the bank is not ready yet. */
  private assemble(): boolean {
    while (this.due()) {
      const k = this.world.next;
      if (!this.director.canAssemble(k)) return false;
      const pick = this.director.select(k, this.tracker.s);
      const seg = this.world.add(pick.chunks);
      this.picks.set(k, pick);
      for (const key of this.picks.keys()) if (!this.world.segs.has(key)) this.picks.delete(key);
      this.onAssemble?.(seg, pick);
    }
    return true;
  }

  /** Advance one frame. Returns false (and does nothing) while waiting on generation. */
  tick(input: Input): boolean {
    if (!this.started) {
      if (this.director instanceof Director && !this.director.canAssemble(1)) { this.waiting = true; return false; }
      this.started = true;
    }
    if (!this.assemble()) { this.waiting = true; return false; }
    this.waiting = false;
    this.player = step(this.player, input, this.world);
    this.tracker.update(this.player, this.world, this.frame);
    this.world.discardBehind(Math.floor(this.playerTileX / T.chunkW));
    this.frame++;
    return true;
  }
}
