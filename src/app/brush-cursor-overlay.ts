// SVG brush ring draped over the terrain under the cursor, projected with the same mapping as the active view.
import { sampleHeightBilinear } from '../input/heightfield-ray-picker';
import type { Vec2 } from '../core/types';
import type { AppTool } from './sculpt-tool-settings';
import { gridToScreen, screenToGrid, type ViewGeometry } from './view-screen-mapping';

const RING_SEGMENTS = 48;
const SVG_NS = 'http://www.w3.org/2000/svg';
// Lifts the ring slightly above the raw heights so the smoothed terrain surface does not hide it.
const RING_LIFT = 0.4;

export class BrushCursorOverlay {
  readonly element: SVGSVGElement;
  private readonly ring: SVGPathElement;
  private readonly dot: SVGCircleElement;
  private visible = false;

  constructor() {
    this.element = document.createElementNS(SVG_NS, 'svg');
    this.element.setAttribute('class', 'ls-brush-cursor');
    this.element.setAttribute('aria-hidden', 'true');
    this.ring = document.createElementNS(SVG_NS, 'path');
    this.ring.setAttribute('class', 'ls-brush-ring');
    this.dot = document.createElementNS(SVG_NS, 'circle');
    this.dot.setAttribute('class', 'ls-brush-dot');
    this.dot.setAttribute('r', '2.5');
    this.element.append(this.ring, this.dot);
    this.hide();
  }

  /** Redraws the ring for the cursor at `client` (null hides it); `active` brightens it while the tool is held. */
  update(geometry: ViewGeometry, client: Vec2 | null, tool: AppTool, radius: number, active: boolean): void {
    const center = client ? screenToGrid(geometry, client.x, client.y) : null;
    if (!center) {
      this.hide();
      return;
    }
    const viewProj = geometry.view === '3d' ? geometry.camera.viewProjection(geometry.rect.width / geometry.rect.height) : null;
    const origin = this.element.getBoundingClientRect();
    const point = (gx: number, gy: number): Vec2 | null => {
      const h = sampleHeightBilinear(geometry.heights, geometry.grid, gx, gy) + RING_LIFT;
      const p = gridToScreen(geometry, viewProj, gx, gy, h);
      return p ? { x: p.x - origin.left, y: p.y - origin.top } : null;
    };
    let d = '';
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const p = point(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius);
      if (!p) continue;
      d += `${d ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }
    const c = point(center.x, center.y);
    if (!d || !c) {
      this.hide();
      return;
    }
    this.ring.setAttribute('d', `${d}Z`);
    this.dot.setAttribute('cx', c.x.toFixed(1));
    this.dot.setAttribute('cy', c.y.toFixed(1));
    this.element.setAttribute('class', `ls-brush-cursor tool-${tool}${active ? ' is-active' : ''}`);
    if (!this.visible) {
      this.visible = true;
      this.element.style.visibility = 'visible';
    }
  }

  hide(): void {
    if (!this.visible && this.element.style.visibility === 'hidden') return;
    this.visible = false;
    this.element.style.visibility = 'hidden';
  }
}
