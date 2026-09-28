// Live projector keystone editing: a calibration grid pinned like the projector surface, plus four draggable corners.
import type { Quad, Vec2 } from '../../core/types';
import { el } from './dom-builder';
import type { KeystoneSurface } from './keystone-surface';
import { identityKeystone } from './physical-calibration-model';
import { QuadDragHandles } from './quad-drag-handles';
import { copyQuad, isUsableQuad } from './quad-geometry';

const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL'] as const;
// Corners may be dragged beyond the surface (projector larger than the box) but not absurdly far.
const MIN_NORM = -0.5;
const MAX_NORM = 1.5;
// Corners usually sit at the screen edge; keep their handles fully on screen.
const HANDLE_INSET_PX = 24;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export class KeystoneEditor {
  private readonly surface: KeystoneSurface;
  private readonly host: HTMLElement;
  private readonly onChange: (q: Quad) => void;
  private quad: Quad = identityKeystone();
  private base: DOMRect | null = null;
  private layer: HTMLElement | null = null;
  private pattern: HTMLElement | null = null;
  private handles: QuadDragHandles | null = null;
  private readonly onResize = (): void => this.apply();

  constructor(surface: KeystoneSurface, host: HTMLElement, onChange: (q: Quad) => void) {
    this.surface = surface;
    this.host = host;
    this.onChange = onChange;
  }

  get isOpen(): boolean {
    return this.layer !== null;
  }

  open(initial: Quad): void {
    this.close();
    this.quad = copyQuad(initial);
    const layer = el('div', 'ls-keystone-layer');
    const corners = CORNER_LABELS.map((label, i) => el('span', { className: `ls-kgrid-corner ls-kgrid-corner--${i}`, text: label }));
    this.pattern = el('div', 'ls-keystone-grid', [
      ...corners,
      el('span', { className: 'ls-kgrid-top', text: '▲ top of the projected image ▲' }),
      el('span', 'ls-kgrid-cross'),
    ]);
    layer.append(this.pattern);
    this.host.append(layer);
    this.layer = layer;
    this.handles = new QuadDragHandles({
      container: layer,
      labels: CORNER_LABELS,
      toLocal: (p) => this.toLocal(p),
      fromLocal: (p) => this.fromLocal(p),
      onMove: (i, p) => this.moveCorner(i, p),
      displayInset: HANDLE_INSET_PX,
    });
    window.addEventListener('resize', this.onResize);
    this.apply();
  }

  close(): void {
    window.removeEventListener('resize', this.onResize);
    this.handles?.destroy();
    this.handles = null;
    this.layer?.remove();
    this.layer = null;
    this.pattern = null;
  }

  reset(): void {
    this.quad = identityKeystone();
    this.apply();
    this.onChange(copyQuad(this.quad));
  }

  focusCorner(index: number): void {
    this.handles?.focus(index);
  }

  private toLocal(p: Vec2): Vec2 {
    const b = this.base;
    return b ? { x: b.left + p.x * b.width, y: b.top + p.y * b.height } : { x: 0, y: 0 };
  }

  private fromLocal(p: Vec2): Vec2 {
    const b = this.base;
    if (!b || !(b.width > 0) || !(b.height > 0)) return { x: 0, y: 0 };
    return {
      x: clamp((p.x - b.left) / b.width, MIN_NORM, MAX_NORM),
      y: clamp((p.y - b.top) / b.height, MIN_NORM, MAX_NORM),
    };
  }

  private moveCorner(index: number, p: Vec2): void {
    const next = copyQuad(this.quad);
    next[index] = p;
    // A fold-over would mirror the projection; keep the last valid shape instead.
    if (!isUsableQuad(next)) {
      this.handles?.setPoints(this.quad);
      return;
    }
    this.quad = next;
    this.apply();
    this.onChange(copyQuad(this.quad));
  }

  private apply(): void {
    this.surface.setKeystone(this.quad);
    this.base = this.surface.layoutRect();
    const pattern = this.pattern;
    if (pattern && this.base) {
      const { left, top, width, height } = this.base;
      pattern.style.left = `${left}px`;
      pattern.style.top = `${top}px`;
      pattern.style.width = `${width}px`;
      pattern.style.height = `${height}px`;
      pattern.style.transform = this.surface.transformFor(width, height);
    }
    this.handles?.setPoints(this.base ? this.quad : [null, null, null, null]);
  }
}
