/**
 * Human input: keyboard (arrows or WASD) and on-screen touch buttons.
 * Produces one quantised action per physics tick. Keyboard steering ramps
 * from centre to full lock over about 0.25 s, which makes recorded driving
 * smoother and therefore much easier for a network to imitate.
 */

const STEER_RAMP = 9; // per tick: 127 / 9 ≈ 14 ticks ≈ 0.24 s to full lock
const STEER_RETURN = 18; // faster return to centre

type Key = 'left' | 'right' | 'up' | 'down';

const KEYMAP: Record<string, Key> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'up',
  KeyS: 'down',
};

export class HumanInput {
  private held = new Set<Key>();
  private touch = new Set<Key>();
  private steer = 0;
  private cleanup: (() => void)[] = [];

  constructor() {
    const down = (e: KeyboardEvent) => {
      const k = KEYMAP[e.code];
      if (k) {
        this.held.add(k);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = KEYMAP[e.code];
      if (k) this.held.delete(k);
    };
    const blur = () => this.held.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    });
  }

  /** Wire an on-screen button (pointer events work for touch, pen and mouse). */
  bindButton(el: HTMLElement, key: Key): void {
    const on = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      this.touch.add(key);
      el.classList.add('pressed');
    };
    const off = () => {
      this.touch.delete(key);
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private is(k: Key): boolean {
    return this.held.has(k) || this.touch.has(k);
  }

  /** True while any driving control is held (used to skip the countdown hint). */
  get active(): boolean {
    return this.held.size + this.touch.size > 0;
  }

  reset(): void {
    this.steer = 0;
  }

  /** Called once per physics tick. Returns [steer, throttle] in -127..127. */
  sample(): [number, number] {
    const target = (this.is('right') ? 127 : 0) - (this.is('left') ? 127 : 0);
    if (target === 0) {
      if (this.steer > 0) this.steer = Math.max(0, this.steer - STEER_RETURN);
      else if (this.steer < 0) this.steer = Math.min(0, this.steer + STEER_RETURN);
    } else if (this.steer < target) this.steer = Math.min(target, this.steer + (this.steer < 0 ? STEER_RETURN : STEER_RAMP));
    else if (this.steer > target) this.steer = Math.max(target, this.steer - (this.steer > 0 ? STEER_RETURN : STEER_RAMP));
    const up = this.is('up');
    const dn = this.is('down');
    const thr = up && !dn ? 127 : dn && !up ? -127 : 0;
    return [this.steer, thr];
  }

  dispose(): void {
    this.cleanup.forEach((f) => f());
  }
}
