// Canvas pointer input: left-drag applies the active tool, right/middle/Space-drag orbits (3D), wheel zooms or
// resizes the brush, two-finger touch orbits and pinch-zooms.
import type { Vec2 } from '../core/types';
import { sampleHeightBilinear } from '../input/heightfield-ray-picker';
import { applySculptBrush, type SculptTool } from '../input/sculpt-tools';
import type { OrbitCamera } from '../render/orbit-camera';
import type { SandboxSession } from './sandbox-session';
import { TOOL_STRENGTH } from './sculpt-tool-settings';
import { screenToGrid, type ViewGeometry } from './view-screen-mapping';

export interface PointerInputHost {
  readonly canvas: HTMLCanvasElement;
  readonly session: SandboxSession;
  readonly camera: OrbitCamera;
  geometry(): ViewGeometry;
  tool(): SculptTool;
  brushRadius(): number;
  changeBrushRadius(delta: number): void;
  sculptBounds(): { min: number; max: number };
  /** First tool contact of a stroke (auto-starts a level waiting on its intro card). */
  onStrokeStart(): void;
}

const ORBIT_RADIANS_PER_PX = 0.006;
const WHEEL_ZOOM_PER_PX = 0.0015;

type DragMode = 'none' | 'tool' | 'orbit' | 'gesture';

export class PointerInputController {
  private readonly host: PointerInputHost;
  private readonly pointers = new Map<number, Vec2>();
  private mode: DragMode = 'none';
  private hover: Vec2 | null = null;
  private flattenTarget: number | undefined;
  private spaceHeld = false;
  private gesture: { dist: number; mid: Vec2 } | null = null;
  private readonly cleanup: () => void;

  constructor(host: PointerInputHost) {
    this.host = host;
    const c = host.canvas;
    const opts: AddEventListenerOptions = { passive: false };
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (ev: HTMLElementEventMap[K]) => void): (() => void) => {
      c.addEventListener(type, fn, opts);
      return () => c.removeEventListener(type, fn);
    };
    const offs = [
      on('pointerdown', (ev) => this.onDown(ev)),
      on('pointermove', (ev) => this.onMove(ev)),
      on('pointerup', (ev) => this.onUp(ev)),
      on('pointercancel', (ev) => this.onUp(ev)),
      on('pointerleave', (ev) => {
        if (ev.pointerType === 'mouse' && this.mode === 'none') this.hover = null;
      }),
      on('wheel', (ev) => this.onWheel(ev)),
      on('contextmenu', (ev) => ev.preventDefault()),
    ];
    this.cleanup = () => offs.forEach((off) => off());
  }

  /** Client position of the brush for the cursor ring (null while orbiting or off-canvas). */
  get brushClient(): Vec2 | null {
    return this.mode === 'orbit' || this.mode === 'gesture' || this.spaceHeld ? null : this.hover;
  }

  get stroking(): boolean {
    return this.mode === 'tool';
  }

  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
    this.host.canvas.classList.toggle('is-orbit-ready', held);
  }

  /** Applies the held tool for this frame's real duration. */
  applyFrame(dtSec: number): void {
    const { session } = this.host;
    const p = this.mode === 'tool' && this.hover ? screenToGrid(this.host.geometry(), this.hover.x, this.hover.y) : null;
    const tool = this.host.tool();
    if (!p || tool !== 'rain') session.clearBrushRain();
    if (!p) return;
    const radius = this.host.brushRadius();
    if (tool === 'rain') {
      session.paintBrushRain(p.x, p.y, radius);
      return;
    }
    const brush = { radius, strength: TOOL_STRENGTH[tool] };
    const bounds = this.host.sculptBounds();
    if (applySculptBrush(session.heights, session.grid, p.x, p.y, tool, brush, dtSec, bounds, this.flattenTarget)) {
      session.markTerrainDirty();
    }
  }

  destroy(): void {
    this.cleanup();
  }

  private onDown(ev: PointerEvent): void {
    ev.preventDefault();
    const pos = { x: ev.clientX, y: ev.clientY };
    this.pointers.set(ev.pointerId, pos);
    try {
      this.host.canvas.setPointerCapture(ev.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured; dragging still works inside the canvas.
    }
    const is3d = this.host.geometry().view === '3d';
    if (ev.pointerType === 'touch' && this.pointers.size >= 2) {
      this.mode = 'gesture';
      this.hover = null;
      this.gesture = this.touchGesture();
      return;
    }
    if (this.mode !== 'none') return;
    if (is3d && (ev.button === 1 || ev.button === 2 || (ev.button === 0 && this.spaceHeld))) {
      this.mode = 'orbit';
      this.host.canvas.classList.add('is-orbiting');
      return;
    }
    if (ev.button !== 0 || this.spaceHeld) return;
    this.mode = 'tool';
    this.hover = pos;
    const start = screenToGrid(this.host.geometry(), pos.x, pos.y);
    this.flattenTarget = start ? sampleHeightBilinear(this.host.session.heights, this.host.session.grid, start.x, start.y) : undefined;
    this.host.onStrokeStart();
  }

  private onMove(ev: PointerEvent): void {
    const pos = { x: ev.clientX, y: ev.clientY };
    const prev = this.pointers.get(ev.pointerId);
    if (prev) this.pointers.set(ev.pointerId, pos);
    if (this.mode === 'orbit' && prev) {
      this.host.camera.rotate(-(pos.x - prev.x) * ORBIT_RADIANS_PER_PX, (pos.y - prev.y) * ORBIT_RADIANS_PER_PX);
    } else if (this.mode === 'gesture') {
      this.updateGesture();
    } else if (ev.pointerType === 'mouse' || this.mode === 'tool') {
      this.hover = pos;
    }
  }

  private onUp(ev: PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    if (this.mode === 'gesture' && this.pointers.size >= 2) {
      this.gesture = this.touchGesture();
      return;
    }
    // After a pinch the remaining finger must lift before painting again, so a gesture never ends in a stray stroke.
    if (this.pointers.size > 0 && this.mode === 'gesture') return;
    if (this.pointers.size > 0 && this.mode !== 'none') return;
    this.mode = 'none';
    this.gesture = null;
    this.host.canvas.classList.remove('is-orbiting');
    if (ev.pointerType !== 'mouse') this.hover = null;
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const scale = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    const delta = ev.deltaY * scale;
    if (ev.altKey || this.host.geometry().view === '2d') {
      if (delta !== 0) this.host.changeBrushRadius(delta < 0 ? 1 : -1);
      return;
    }
    this.host.camera.zoom(Math.exp(Math.max(-200, Math.min(200, delta)) * WHEEL_ZOOM_PER_PX));
  }

  private touchGesture(): { dist: number; mid: Vec2 } | null {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  private updateGesture(): void {
    const next = this.touchGesture();
    const prev = this.gesture;
    this.gesture = next;
    if (!next || !prev || this.host.geometry().view !== '3d') return;
    this.host.camera.rotate(-(next.mid.x - prev.mid.x) * ORBIT_RADIANS_PER_PX, (next.mid.y - prev.mid.y) * ORBIT_RADIANS_PER_PX);
    if (prev.dist > 10 && next.dist > 10) this.host.camera.zoom(prev.dist / next.dist);
  }
}
