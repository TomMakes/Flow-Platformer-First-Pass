import { type Dir, type Input } from '../sim/types';

const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const JUMP = new Set(['Space', 'KeyW', 'ArrowUp']);

/** Keyboard to Input, plus one-shot toggle keys. */
export class Keyboard {
  private down = new Set<string>();
  private pressed: string[] = [];
  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if ([...LEFT, ...RIGHT, ...JUMP].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }
  private any(s: Set<string>): boolean { for (const k of s) if (this.down.has(k)) return true; return false; }
  read(): Input {
    const dir = ((this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0)) as Dir;
    return { dir, jump: this.any(JUMP) };
  }
  /** Keys pressed since the last call (for toggles). */
  takePressed(): string[] { const p = this.pressed; this.pressed = []; return p; }
}
