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
    changeBrushRadius: (d) => app.setBrushRadius(app.brushRadius + d),
    sculptBounds: () => ({ min: 0, max: app.relief }),
    onStrokeStart: () => {
      // Touching the terrain during the briefing starts the level, so "just start digging" works.
      if (app.session.game.phase === 'ready' && app.session.level.villages.length > 0) app.startLevel();
    },
  });
  const detachKeys = installKeyboardShortcuts({
    setTool: (t) => app.setTool(t),
    toggleView: () => app.setView(app.view === '2d' ? '3d' : '2d'),
    resetLevel: () => app.resetLevel(),
    startLevel: () => app.startLevel(),
    changeBrush: (d) => app.setBrushRadius(app.brushRadius + d),
    toggleHelp: () => app.hud.toggleHelp(),
    toggleFullscreen: () => app.toggleFullscreen(),
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
