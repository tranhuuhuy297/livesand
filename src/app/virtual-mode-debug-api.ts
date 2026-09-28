// window.__livesand.debug for virtual mode: water/heights readback, scripted frames and a JSON state snapshot.
import type { LiveSandDebugApi } from './livesand-debug-api';
import { stepFramesScripted } from './scripted-frame-stepper';
import type { VirtualModeApp } from './virtual-mode-app';

export function createVirtualModeDebugApi(app: VirtualModeApp): LiveSandDebugApi {
  return {
    readWater: () => app.session.readWater(),
    getHeights: () => app.session.heights.slice(),
    stepFrames: (n, dtSec = 1 / 60) =>
      stepFramesScripted(app.loop, app.gpu.device, n, dtSec, (dt, draw) => app.stepScripted(dt, draw)),
    state: () => {
      const { game, level } = app.session;
      const duration = level.durationSec;
      return {
        mode: 'virtual',
        view: app.view,
        level: level.id,
        levelName: level.name,
        phase: game.phase,
        elapsedSec: game.elapsedSec,
        durationSec: Number.isFinite(duration) ? duration : null,
        rainRate: game.currentRainRate(),
        villages: game.villages.map((v) => ({
          name: v.spec.name,
          state: v.state,
          floodedSec: v.floodedSec,
          x: v.x,
          y: v.y,
          radius: v.radius,
        })),
        probeDepths: Array.from(app.scene.probeValues() ?? []),
        summary: game.summary(),
        tool: app.tool,
        brushRadius: app.brushRadius,
        speed: app.speed,
        simSteps: app.session.totalSteps,
        fps: app.loop.fps,
        grid: { ...app.session.grid },
        canvas: app.stage.pixelSize,
        gpuErrors: [...app.monitor.errors],
      };
    },
  };
}
