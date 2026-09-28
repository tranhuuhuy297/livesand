// Four draggable, keyboard-nudgeable corner handles over a container, in any model coordinate space.
import type { Vec2 } from '../../core/types';
import { el } from './dom-builder';

export interface QuadHandlesOptions {
  /** Positioned element the handles live in; local px are relative to its top-left corner. */
  container: HTMLElement;
  labels: readonly [string, string, string, string];
  toLocal(p: Vec2): Vec2;
  /** Local px -> model coords; clamp here to keep corners in range. */
  fromLocal(p: Vec2): Vec2;
  onMove(index: number, p: Vec2): void;
  /** Keep handles at least this many px inside the container so corners at its edge stay grabbable. */
  displayInset?: number;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(lo, hi), Math.max(lo, v));
}

export class QuadDragHandles {
  private readonly opts: QuadHandlesOptions;
  private readonly handles: HTMLButtonElement[];
  private points: (Vec2 | null)[] = [null, null, null, null];

  constructor(opts: QuadHandlesOptions) {
    this.opts = opts;
    this.handles = opts.labels.map((label, i) => {
      const h = el('button', {
        className: `ls-handle ls-handle--${i}`,
        text: label,
        attrs: { type: 'button', 'aria-label': `${label} corner: drag, or focus and use the arrow keys`, 'data-corner': String(i) },
      });
      h.hidden = true;
      h.addEventListener('pointerdown', (e) => this.beginDrag(i, e));
      h.addEventListener('keydown', (e) => this.nudge(i, e));
      opts.container.append(h);
      return h;
    });
  }

  setPoints(points: readonly (Vec2 | null)[]): void {
    this.points = points.map((p) => (p ? { ...p } : null));
    this.layout();
  }

  /** Re-positions handles, e.g. after the container resized. */
  layout(): void {
    this.handles.forEach((h, i) => {
      const p = this.points[i];
      h.hidden = !p;
      if (!p) return;
      const local = this.opts.toLocal(p);
      const inset = this.opts.displayInset;
      const box = this.opts.container;
      h.style.left = `${inset === undefined ? local.x : clamp(local.x, inset, box.clientWidth - inset)}px`;
      h.style.top = `${inset === undefined ? local.y : clamp(local.y, inset, box.clientHeight - inset)}px`;
    });
  }

  focus(index: number): void {
    this.handles[index]?.focus();
  }

  destroy(): void {
    for (const h of this.handles) h.remove();
  }

  private commit(index: number, p: Vec2): void {
    this.points[index] = p;
    this.layout();
    this.opts.onMove(index, p);
  }

  private beginDrag(index: number, e: PointerEvent): void {
    const start = this.points[index];
    if (!start || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const h = this.handles[index];
    h.focus();
    h.setPointerCapture(e.pointerId);
    h.classList.add('is-dragging');
    const rect = this.opts.container.getBoundingClientRect();
    const local = this.opts.toLocal(start);
    // Keep the grab offset so the corner doesn't jump under the pointer.
    const offX = e.clientX - rect.left - local.x;
    const offY = e.clientY - rect.top - local.y;
    const move = (ev: PointerEvent) => {
      const r = this.opts.container.getBoundingClientRect();
      this.commit(index, this.opts.fromLocal({ x: ev.clientX - r.left - offX, y: ev.clientY - r.top - offY }));
    };
    const end = (ev: PointerEvent) => {
      if (h.hasPointerCapture(ev.pointerId)) h.releasePointerCapture(ev.pointerId);
      h.classList.remove('is-dragging');
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', end);
      h.removeEventListener('pointercancel', end);
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  }

  private nudge(index: number, e: KeyboardEvent): void {
    const dir = ARROWS[e.key];
    const p = this.points[index];
    if (!dir || !p) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const local = this.opts.toLocal(p);
    this.commit(index, this.opts.fromLocal({ x: local.x + dir[0] * step, y: local.y + dir[1] * step }));
  }
}
