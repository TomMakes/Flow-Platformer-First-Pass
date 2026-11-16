import type { Input } from '../sim/types';

export class KeyboardInput {
  private down = new Set<string>();
  private pressedOnce = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressedOnce.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  read(): Input {
    const left = this.down.has('KeyA') || this.down.has('ArrowLeft');
    const right = this.down.has('KeyD') || this.down.has('ArrowRight');
    const jump = this.down.has('Space') || this.down.has('KeyW') || this.down.has('ArrowUp');
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    return { dir: dir as -1 | 0 | 1, jump };
  }

  /** True once per key press, for toggles (H, G, R). */
  consume(code: string): boolean {
    return this.pressedOnce.delete(code);
  }
}
