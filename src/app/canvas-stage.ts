// Full-window stage holding the WebGPU canvas; keeps the drawing buffer matched to CSS size x devicePixelRatio.
import type { GridSize } from '../core/types';
import { h } from './hud-dom-helpers';

/** Drawing-buffer pixel budget: 4K monitors at DPR 2 would otherwise shade ~33 M pixels per frame. */
export const MAX_CANVAS_PIXELS = 2_800_000;

export class CanvasStage {
  readonly root: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private width = 0;
  private height = 0;

  constructor(grid: GridSize, className = '') {
    this.canvas = h('canvas', { class: 'ls-canvas', attrs: { 'aria-label': 'Sandbox simulation', role: 'img' } });
    this.root = h('div', { class: `ls-stage ${className}`.trim() }, [this.canvas]);
    this.root.style.setProperty('--grid-aspect', String(grid.width / grid.height));
  }

  /** Resizes the drawing buffer when the element size or DPR changed; returns true if it did. */
  syncSize(): boolean {
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0) return false;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH));
    dpr = Math.min(dpr, budget);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h2 = Math.max(1, Math.round(cssH * dpr));
    if (w === this.width && h2 === this.height) return false;
    this.width = w;
    this.height = h2;
    this.canvas.width = w;
    this.canvas.height = h2;
    return true;
  }

  get pixelSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}
