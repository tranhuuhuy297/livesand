// Applies the projector corner-pin (CSS matrix3d) to the attached element and keeps it correct across resizes.
import { cornerPinCssTransform } from '../../core/homography';
import type { Quad } from '../../core/types';
import { identityKeystone } from './physical-calibration-model';
import { copyQuad, quadsEqual, scaleQuad } from './quad-geometry';

export class KeystoneSurface {
  private el: HTMLElement | null = null;
  private original: { transform: string; transformOrigin: string } | null = null;
  private quad: Quad = identityKeystone();
  private observer: ResizeObserver | null = null;
  private readonly onResize = (): void => this.apply();

  get element(): HTMLElement | null {
    return this.el;
  }

  /** Normalized corner-pin quad (unit square = untouched). */
  get keystone(): Quad {
    return copyQuad(this.quad);
  }

  attach(el: HTMLElement): void {
    if (this.el === el) return;
    this.detach();
    this.el = el;
    this.original = { transform: el.style.transform, transformOrigin: el.style.transformOrigin };
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.onResize);
      this.observer.observe(el);
    }
    window.addEventListener('resize', this.onResize);
    this.apply();
  }

  /** Restores the element's own transform. */
  detach(): void {
    const el = this.el;
    if (!el) return;
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener('resize', this.onResize);
    if (this.original) {
      el.style.transform = this.original.transform;
      el.style.transformOrigin = this.original.transformOrigin;
    }
    this.el = null;
    this.original = null;
  }

  setKeystone(q: Quad): void {
    this.quad = copyQuad(q);
    this.apply();
  }

  /** Untransformed layout box in viewport px: the frame keystone handles and the grid overlay are placed in. */
  layoutRect(): DOMRect | null {
    const el = this.el;
    if (!el) return null;
    const prev = el.style.transform;
    el.style.transform = 'none';
    const rect = el.getBoundingClientRect();
    el.style.transform = prev;
    return rect;
  }

  /** CSS transform that corner-pins a width x height box with the current keystone ('' = none needed). */
  transformFor(width: number, height: number): string {
    if (!(width > 0) || !(height > 0) || quadsEqual(this.quad, identityKeystone())) return '';
    try {
      return cornerPinCssTransform(width, height, scaleQuad(this.quad, width, height));
    } catch (err) {
      console.warn(`Projector keystone ignored: ${(err as Error).message}`);
      return '';
    }
  }

  private apply(): void {
    const el = this.el;
    if (!el) return;
    el.style.transformOrigin = '0 0';
    el.style.transform = this.transformFor(el.offsetWidth, el.offsetHeight);
  }
}
