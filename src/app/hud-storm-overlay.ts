// Screen-space storm over the canvas: falling rain streaks scaled by storm strength and a lightning flash as it breaks.
import './hud-storm-overlay.css';
import { h, setHidden } from './hud-dom-helpers';

const FLASH_AT = 0.6;
const REARM_BELOW = 0.3;

export class StormOverlay {
  readonly root: HTMLDivElement;
  private readonly flash = h('div', { class: 'ls-lightning' });
  private shown = -1;
  private flashArmed = true;

  constructor() {
    this.root = h('div', { class: 'ls-storm-fx', attrs: { 'aria-hidden': 'true' } }, [
      h('div', { class: 'ls-rain-layer is-far' }),
      h('div', { class: 'ls-rain-layer is-near' }),
      this.flash,
    ]);
    this.root.hidden = true;
  }

  /** `storm` 0..1; the streak opacity follows it in 5% steps so the style is not rewritten every frame. */
  update(storm: number): void {
    const level = Math.round(Math.min(1, Math.max(0, storm)) * 20) / 20;
    if (level !== this.shown) {
      this.shown = level;
      this.root.style.setProperty('--storm', String(level));
      setHidden(this.root, level <= 0);
    }
    if (storm >= FLASH_AT && this.flashArmed) {
      this.flashArmed = false;
      this.strike();
    } else if (storm < REARM_BELOW) {
      this.flashArmed = true;
    }
  }

  private strike(): void {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    this.flash.animate?.(
      [{ opacity: 0 }, { opacity: 0.8, offset: 0.06 }, { opacity: 0.08, offset: 0.2 }, { opacity: 0.55, offset: 0.28 }, { opacity: 0 }],
      { duration: 1000, easing: 'ease-out' },
    );
  }
}
