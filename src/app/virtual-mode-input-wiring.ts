// Connects canvas pointer input and global keyboard shortcuts to the virtual-mode app actions.
import { PointerInputController } from './pointer-input-controller';
import { installKeyboardShortcuts } from './keyboard-shortcuts';
import type { VirtualModeApp } from './virtual-mode-app';

export interface VirtualModeInput {
  pointer: PointerInputController;
  detach(): void;
}

export function wireVirtualModeInput(app: VirtualModeApp): VirtualModeInput {
  const pointer = new PointerInputController({
    canvas: app.stage.canvas,
    session: app.session,
    camera: app.camera,
    geometry: () => app.geometry(),
    tool: () => app.tool,
    brushRadius: () => app.brushRadius,
    changeBrushRadius: (d) => app.actions.setBrushRadius(app.brushRadius + d),
    sculptBounds: () => ({ min: 0, max: app.levels.sculptMax, floor: app.session.sculptFloor }),
    onStrokeStart: () => app.actions.onStrokeStart(),
  });
  // Dialogs that pause the game also keep Enter/R from starting or restarting it out of sight.
  const unlessPaused = (fn: () => void) => () => {
    if (!app.hud.pausesGame) fn();
  };
  const detachKeys = installKeyboardShortcuts({
    setTool: (t) => app.actions.setTool(t),
    toggleView: () => app.setView(app.view === '2d' ? '3d' : '2d'),
    resetLevel: unlessPaused(() => app.actions.resetLevel()),
    startLevel: unlessPaused(() => app.actions.startLevel()),
    changeBrush: (d) => app.actions.setBrushRadius(app.brushRadius + d),
    toggleHelp: () => app.hud.toggleHelp(),
    toggleFullscreen: () => app.actions.toggleFullscreen(),
    setSpaceHeld: (held) => pointer.setSpaceHeld(held),
    escape: () => app.hud.closeOverlays(),
  });
  return {
    pointer,
    detach: () => {
      detachKeys();
      pointer.destroy();
    },
  };
}
