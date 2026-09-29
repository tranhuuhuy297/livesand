// Pulsing dashed line showing where a level's briefing suggests building (or digging), draped over the terrain in both
// views; shown under the briefing and for the first seconds of each attempt, when the player is looking for the spot.
import type { Vec2 } from '../core/types';
import type { LevelDefinition } from '../game/level-definitions';
import type { GamePhase } from '../game/village-flood-game';
import { layoutToCell } from '../game/terrain-generators';
import { sampleHeightBilinear } from '../input/heightfield-ray-picker';
import { gridToScreen, type ViewGeometry } from './view-screen-mapping';

/** Seconds into an attempt the hint stays up (Mount Ember's opening rumble lasts 6 s). */
export const HINT_VISIBLE_SEC = 10;
const SAMPLES = 24;
const SVG_NS = 'http://www.w3.org/2000/svg';
// Drawn a little above the raw heights so the smoothed terrain surface does not swallow it.
const LIFT = 0.6;

export function hintVisible(level: LevelDefinition, phase: GamePhase, elapsedSec: number): boolean {
  return level.hint !== undefined && (phase === 'ready' || (phase === 'running' && elapsedSec < HINT_VISIBLE_SEC));
}

export class LevelHintOverlay {
  readonly element: SVGSVGElement;
  private readonly path: SVGPathElement;
  private shown = false;

  constructor() {
    this.element = document.createElementNS(SVG_NS, 'svg');
    this.element.setAttribute('class', 'ls-level-hint');
    this.element.setAttribute('aria-hidden', 'true');
    this.path = document.createElementNS(SVG_NS, 'path');
    this.element.append(this.path);
    this.element.style.visibility = 'hidden';
  }

  update(geometry: ViewGeometry, level: LevelDefinition, phase: GamePhase, elapsedSec: number): void {
    const hint = level.hint;
    if (!hint || !hintVisible(level, phase, elapsedSec)) {
      this.hide();
      return;
    }
    const { grid } = geometry;
    const viewProj = geometry.view === '3d' ? geometry.camera.viewProjection(geometry.rect.width / geometry.rect.height) : null;
    const origin = this.element.getBoundingClientRect();
    let d = '';
    for (let i = 0; i <= SAMPLES; i++) {
      const k = i / SAMPLES;
      const gx = layoutToCell(hint.from.u + (hint.to.u - hint.from.u) * k, grid.width);
      const gy = layoutToCell(hint.from.v + (hint.to.v - hint.from.v) * k, grid.height);
      const p: Vec2 | null = gridToScreen(geometry, viewProj, gx, gy, sampleHeightBilinear(geometry.heights, grid, gx, gy) + LIFT);
      if (p) d += `${d ? 'L' : 'M'}${(p.x - origin.left).toFixed(1)} ${(p.y - origin.top).toFixed(1)}`;
    }
    if (!d) {
      this.hide();
      return;
    }
    this.path.setAttribute('d', d);
    this.element.setAttribute('class', `ls-level-hint tool-${hint.tool}`);
    if (!this.shown) {
      this.shown = true;
      this.element.style.visibility = 'visible';
    }
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.element.style.visibility = 'hidden';
  }
}
