// Screen side of virtual mode: portrait layout, the quarter-turned 2D map (never on real maps, which stay north-up so
// locals recognise them) and the overlays over the canvas: brush ring, level hint and a north arrow while turned.
import type { Vec2 } from '../core/types';
import type { LevelDefinition } from '../game/level-definitions';
import type { VillageFloodGame } from '../game/village-flood-game';
import type { ViewMode } from './app-url-params';
import { BrushCursorOverlay } from './brush-cursor-overlay';
import type { CanvasStage } from './canvas-stage';
import { h, setHidden } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import { LevelHintOverlay } from './level-hint-overlay';
import type { AppTool } from './sculpt-tool-settings';
import type { ViewGeometry } from './view-screen-mapping';

/** The brush under the pointer this frame (client null when the pointer is off the terrain). */
export interface BrushState {
  client: Vec2 | null;
  tool: AppTool;
  radius: number;
  active: boolean;
}

export class VirtualModeScreen {
  readonly cursor = new BrushCursorOverlay();
  readonly hint = new LevelHintOverlay();
  private readonly compass: HTMLDivElement;
  private readonly appRoot: HTMLElement;
  private readonly stage: CanvasStage;
  private portrait = false;
  private northUp = false;
  private compassAt = '';

  constructor(appRoot: HTMLElement, stage: CanvasStage) {
    this.appRoot = appRoot;
    this.stage = stage;
    this.compass = h('div', { class: 'ls-compass ls-glass', title: 'North is to the right', attrs: { role: 'img' } }, [
      h('span', { class: 'ls-compass-n', text: 'N' }),
      h('span', { class: 'ls-icon', html: ICONS.next, attrs: { 'aria-hidden': 'true' } }),
    ]);
    this.compass.hidden = true;
  }

  /** Overlay elements, in stacking order, for the app root. */
  get elements(): Element[] {
    return [this.hint.element, this.cursor.element, this.compass];
  }

  get isPortrait(): boolean {
    return this.portrait;
  }

  /** The 2D map is drawn a quarter-turned (west at the top): portrait screens, except on real maps. */
  rotated(view: ViewMode): boolean {
    return view === '2d' && this.portrait && !this.northUp;
  }

  /** Portrait toggles the class (CSS swaps the 2D canvas aspect), then the drawing buffer follows. */
  sync(): void {
    const portrait = window.innerWidth < window.innerHeight;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.appRoot.classList.toggle('is-portrait', portrait);
    }
    this.stage.syncSize();
  }

  /** Real maps keep north up in every orientation; returns whether that changed. */
  setNorthUp(on: boolean): boolean {
    if (on === this.northUp) return false;
    this.northUp = on;
    this.appRoot.classList.toggle('is-north-up', on);
    return true;
  }

  /** Brush ring, the level's hint line and the north arrow for this frame. */
  drawOverlays(geometry: ViewGeometry, session: { level: LevelDefinition; game: VillageFloodGame }, brush: BrushState): void {
    this.cursor.update(geometry, brush.client, brush.tool, brush.radius, brush.active);
    this.hint.update(geometry, session.level, session.game.phase, session.game.elapsedSec);
    this.updateCompass(geometry.view, geometry.rect);
  }

  /** North arrow in the turned map's top-right corner (north points right), so level text stays readable. */
  private updateCompass(view: ViewMode, rect: DOMRect): void {
    const show = this.rotated(view);
    setHidden(this.compass, !show);
    if (!show) return;
    const at = `${Math.round(rect.right - 8)}px|${Math.round(rect.top + 8)}px`;
    if (at === this.compassAt) return;
    this.compassAt = at;
    [this.compass.style.left, this.compass.style.top] = at.split('|');
  }
}
