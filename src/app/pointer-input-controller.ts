// Canvas pointer input: left-drag applies the active tool, right/middle/Space-drag orbits (3D), wheel zooms or
// resizes the brush, two-finger touch orbits and pinch-zooms.
import type { Vec2 } from '../core/types';
import { sampleHeightBilinear } from '../input/heightfield-ray-picker';
import { applySculptStroke, type SculptBounds, type SculptTool } from '../input/sculpt-tools';
import type { OrbitCamera } from '../render/orbit-camera';
import type { SandboxSession } from './sandbox-session';
import { TOOL_STRENGTH } from './sculpt-tool-settings';
import { applyPinchOrbit, applyWheel, ORBIT_RADIANS_PER_PX, pinchState, type PinchState } from './pointer-camera-gestures';
import { screenToGrid, type ViewGeometry } from './view-screen-mapping';

export interface PointerInputHost {
  readonly canvas: HTMLCanvasElement;
  readonly session: SandboxSession;
  readonly camera: OrbitCamera;
  geometry(): ViewGeometry;
  tool(): SculptTool;
  brushRadius(): number;
  changeBrushRadius(delta: number): void;
  sculptBounds(): SculptBounds;
  /** First tool contact of a stroke (auto-starts a level waiting on its intro card). */
  onStrokeStart(): void;
}

/** A touch becomes a stroke once it moves this far or stays down this long without a second finger. */
export const TOUCH_SLOP_PX = 8;
export const TOUCH_HOLD_SEC = 0.1;

// 'pending': a lone touch that may still turn into a two-finger gesture, so it neither sculpts nor starts the level.
type DragMode = 'none' | 'pending' | 'tool' | 'orbit' | 'gesture';

export class PointerInputController {
  private readonly host: PointerInputHost;
  private readonly pointers = new Map<number, Vec2>();
  private mode: DragMode = 'none';
  private hover: Vec2 | null = null;
  private strokeStart: Vec2 | null = null;
  private pendingSec = 0;
  private lastGrid: Vec2 | null = null;
  private flattenTarget: number | undefined;
  private spaceHeld = false;
  private gesture: PinchState | null = null;
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
      on('wheel', (ev) => {
        ev.preventDefault();
        applyWheel(ev, host.geometry().view, host.camera, (d) => host.changeBrushRadius(d));
      }),
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

  /** Applies the held tool for this frame: rain follows the cursor, sculpting follows the path since last frame. */
  applyFrame(dtSec: number): void {
    const { session } = this.host;
    if (this.mode === 'pending') {
      this.pendingSec += dtSec;
      if (this.pendingSec >= TOUCH_HOLD_SEC) this.beginStroke();
    }
    const p = this.mode === 'tool' && this.hover ? screenToGrid(this.host.geometry(), this.hover.x, this.hover.y) : null;
    const tool = this.host.tool();
    if (!p || tool !== 'rain') session.clearBrushRain();
    const last = this.lastGrid;
    this.lastGrid = p;
    if (!p) return;
    const radius = this.host.brushRadius();
    if (tool === 'rain') {
      session.paintBrushRain(p.x, p.y, radius);
      return;
    }
    const brush = { radius, strength: TOOL_STRENGTH[tool] };
    if (applySculptStroke(session.heights, session.grid, last, p, tool, brush, dtSec, this.host.sculptBounds(), this.flattenTarget)) {
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
      this.lastGrid = null;
      this.gesture = pinchState(this.pointers);
      return;
    }
    if (this.mode !== 'none') return;
    if (is3d && (ev.button === 1 || ev.button === 2 || (ev.button === 0 && this.spaceHeld))) {
      this.mode = 'orbit';
      this.host.canvas.classList.add('is-orbiting');
      return;
    }
    if (ev.button !== 0 || this.spaceHeld) return;
    this.hover = pos;
    this.strokeStart = pos;
    this.lastGrid = null;
    if (ev.pointerType === 'touch') {
      this.mode = 'pending';
      this.pendingSec = 0;
      return;
    }
    this.beginStroke();
  }

  private beginStroke(): void {
    this.mode = 'tool';
    const start = this.strokeStart ?? this.hover;
    const at = start ? screenToGrid(this.host.geometry(), start.x, start.y) : null;
    this.flattenTarget = at ? sampleHeightBilinear(this.host.session.heights, this.host.session.grid, at.x, at.y) : undefined;
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
    } else if (this.mode === 'pending' && prev) {
      this.hover = pos;
      const start = this.strokeStart ?? pos;
      if (Math.hypot(pos.x - start.x, pos.y - start.y) >= TOUCH_SLOP_PX) this.beginStroke();
    } else if (ev.pointerType === 'mouse' || this.mode === 'tool') {
      this.hover = pos;
    }
  }

  private onUp(ev: PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    if (this.mode === 'gesture' && this.pointers.size >= 2) {
      this.gesture = pinchState(this.pointers);
      return;
    }
    // After a pinch the remaining finger must lift before painting again, so a gesture never ends in a stray stroke.
    if (this.pointers.size > 0 && this.mode !== 'none') return;
    this.mode = 'none';
    this.gesture = null;
    this.strokeStart = null;
    this.lastGrid = null;
    this.host.canvas.classList.remove('is-orbiting');
    if (ev.pointerType !== 'mouse') this.hover = null;
  }

  private updateGesture(): void {
    const next = pinchState(this.pointers);
    const prev = this.gesture;
    this.gesture = next;
    if (next && prev && this.host.geometry().view === '3d') applyPinchOrbit(this.host.camera, prev, next);
  }
}
