// Wizard step 1: live false-colour depth; the user clicks, then drags, the four sandbox corners (TL, TR, BR, BL).
import { applyHomography, computeHomography } from '../../core/homography';
import type { Quad, Vec2 } from '../../core/types';
import type { WizardStep, WizardStepContext } from './calibration-wizard-types';
import { draftRoiQuad } from './calibration-wizard-draft';
import { DEPTH_GRADIENT_CSS, FalseColorCanvas } from './depth-preview-canvas';
import { button, el, svgEl } from './dom-builder';
import { QuadDragHandles } from './quad-drag-handles';
import { rectQuad, unitSquareQuad } from './quad-geometry';

const CORNER_NAMES = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];
const LABELS = ['TL', 'TR', 'BR', 'BL'] as const;
const MESH_DIVISIONS = 4;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export class SandboxCornersStep implements WizardStep {
  readonly title = 'Mark the sandbox corners';
  readonly short = 'Corners';
  private readonly ctx: WizardStepContext;
  private readonly preview = new FalseColorCanvas();
  private stage: HTMLElement | null = null;
  private handles: QuadDragHandles | null = null;
  private outline: SVGPolylineElement | null = null;
  private mesh: SVGPathElement | null = null;
  private items: HTMLElement[] = [];
  private legendNear: HTMLElement | null = null;
  private legendFar: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private seenSeq = -1;

  constructor(ctx: WizardStepContext) {
    this.ctx = ctx;
  }

  mount(body: HTMLElement): void {
    const { depthWidth: w, depthHeight: h } = this.ctx.draft;
    const svg = svgEl('svg', { class: 'ls-roi-svg', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none' });
    this.mesh = svgEl('path', { class: 'ls-roi-mesh' });
    this.outline = svgEl('polyline', { class: 'ls-roi-outline' });
    svg.append(this.mesh, this.outline);
    const stage = el('div', { className: 'ls-stage ls-stage--pick', attrs: { 'data-testid': 'roi-stage' } }, [this.preview.canvas, svg]);
    stage.style.aspectRatio = `${w} / ${h}`;
    stage.style.width = `min(100%, calc(56vh * ${w / h}))`;
    stage.addEventListener('click', (e) => this.place(e));
    this.stage = stage;
    this.handles = new QuadDragHandles({
      container: stage,
      labels: LABELS,
      toLocal: (p) => ({ x: (p.x / w) * stage.clientWidth, y: (p.y / h) * stage.clientHeight }),
      fromLocal: (p) => ({
        x: clamp((p.x / Math.max(1, stage.clientWidth)) * w, 0, w),
        y: clamp((p.y / Math.max(1, stage.clientHeight)) * h, 0, h),
      }),
      onMove: (i, p) => this.setCorner(i, p),
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.handles?.layout());
      this.observer.observe(stage);
    }
    const bar = el('span', 'ls-legend-bar');
    bar.style.background = DEPTH_GRADIENT_CSS;
    this.legendFar = el('span', { text: 'far' });
    this.legendNear = el('span', { text: 'near' });
    this.items = CORNER_NAMES.map((name, i) => el('li', { className: 'ls-corner-item', attrs: { 'data-corner': String(i) } }, [
      el('span', { className: `ls-corner-dot ls-corner-dot--${i}`, text: LABELS[i] }), name,
    ]));
    body.append(el('div', 'ls-step-grid', [
      el('div', 'ls-stage-col', [stage, el('div', 'ls-legend', [this.legendFar, bar, this.legendNear])]),
      el('div', 'ls-side', [
        el('p', { className: 'ls-lead', text: 'Click the four inside corners of the sandbox on the depth image, in this order:' }),
        el('ol', 'ls-corner-list', this.items),
        el('p', {
          className: 'ls-tip',
          text: '“Top” is the edge where the top of the projected image should land. Drag a handle to fine-tune it, or focus it and nudge with the arrow keys (Shift = 10×).',
        }),
        el('div', 'ls-row', [
          button('Redo corners', () => this.clear(), 'ls-btn ls-btn--ghost'),
          button('Use whole image', () => this.useWholeImage(), 'ls-btn ls-btn--ghost'),
        ]),
      ]),
    ]));
    this.seenSeq = -1;
    this.render();
  }

  unmount(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.handles?.destroy();
    this.handles = null;
    this.stage = null;
  }

  tick(): void {
    const latest = this.ctx.host.latestFrame();
    const { depthWidth, depthHeight } = this.ctx.draft;
    if (!latest || latest.seq === this.seenSeq || latest.frame.width !== depthWidth || latest.frame.height !== depthHeight) return;
    this.seenSeq = latest.seq;
    const range = this.preview.drawDepth(latest.frame);
    if (range && this.legendFar && this.legendNear) {
      this.legendFar.textContent = `${range.far.toFixed(2)} m`;
      this.legendNear.textContent = `${range.near.toFixed(2)} m`;
    }
  }

  canAdvance(): boolean {
    return draftRoiQuad(this.ctx.draft) !== null;
  }

  private place(e: MouseEvent): void {
    const stage = this.stage;
    if (!stage || (e.target as Element | null)?.closest('.ls-handle')) return;
    const next = this.ctx.draft.roiCorners.findIndex((c) => c === null);
    if (next < 0) return;
    const r = stage.getBoundingClientRect();
    const { depthWidth: w, depthHeight: h } = this.ctx.draft;
    this.setCorner(next, {
      x: clamp(((e.clientX - r.left) / r.width) * w, 0, w),
      y: clamp(((e.clientY - r.top) / r.height) * h, 0, h),
    });
    this.handles?.focus(next);
  }

  private setCorner(index: number, p: Vec2): void {
    const draft = this.ctx.draft;
    draft.roiCorners[index] = { ...p };
    this.clearReference();
    this.render();
  }

  private clear(): void {
    this.ctx.draft.roiCorners = [null, null, null, null];
    this.clearReference();
    this.render();
  }

  private useWholeImage(): void {
    const { depthWidth: w, depthHeight: h } = this.ctx.draft;
    rectQuad(w, h).forEach((p, i) => this.setCorner(i, p));
  }

  /** The reference is stored per grid cell through the ROI, so any corner change invalidates it. */
  private clearReference(): void {
    const draft = this.ctx.draft;
    draft.referenceDepth = null;
    draft.referencePlaneMeters = null;
    draft.referenceStats = null;
  }

  private render(): void {
    const corners = this.ctx.draft.roiCorners;
    this.handles?.setPoints(corners);
    const placed = corners.filter((c): c is Vec2 => c !== null);
    const quad = draftRoiQuad(this.ctx.draft);
    const closed = placed.length === 4 ? [...placed, placed[0]] : placed;
    this.outline?.setAttribute('points', closed.map((p) => `${p.x},${p.y}`).join(' '));
    this.outline?.classList.toggle('is-invalid', placed.length === 4 && !quad);
    this.mesh?.setAttribute('d', quad ? meshPath(quad) : '');
    const nextIndex = corners.findIndex((c) => c === null);
    this.items.forEach((item, i) => {
      item.classList.toggle('is-done', corners[i] !== null);
      item.classList.toggle('is-next', i === nextIndex);
    });
    if (placed.length === 4 && !quad) {
      this.ctx.notify('Those corners cross over. Place them clockwise: top-left, top-right, bottom-right, bottom-left.', 'warn');
    } else {
      this.ctx.notify(null);
    }
    this.ctx.refresh();
  }
}

/** Inner grid lines of the ROI (homographies keep lines straight, so endpoints suffice). */
function meshPath(quad: Quad): string {
  const h = computeHomography(unitSquareQuad(), quad);
  const parts: string[] = [];
  for (let i = 1; i < MESH_DIVISIONS; i++) {
    const t = i / MESH_DIVISIONS;
    for (const [a, b] of [[{ x: t, y: 0 }, { x: t, y: 1 }], [{ x: 0, y: t }, { x: 1, y: t }]]) {
      const p = applyHomography(h, a);
      const q = applyHomography(h, b);
      parts.push(`M${p.x},${p.y}L${q.x},${q.y}`);
    }
  }
  return parts.join('');
}
