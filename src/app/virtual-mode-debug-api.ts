// window.__livesand.debug for virtual mode: water/lava/rock/heights readback, scripted frames and a JSON state snapshot.
import { allowsLavaTool, LEVELS } from '../game/level-definitions';
import type { LiveSandDebugApi } from './livesand-debug-api';
import { stepFramesScripted } from './scripted-frame-stepper';
import type { VirtualModeApp } from './virtual-mode-app';

export function createVirtualModeDebugApi(app: VirtualModeApp): LiveSandDebugApi {
  const lavaSim = () => {
    if (!app.scene.lava) throw new Error('This scene has no lava simulation');
    return app.scene.lava.sim;
  };
  return {
    readWater: () => app.scene.sim.readWater(),
    readLava: async () => lavaSim().readLava(),
    readRock: async () => lavaSim().readRock(),
    getHeights: () => app.session.heights.slice(),
    stepFrames: (n, dtSec = 1 / 60, draw = true) =>
      stepFramesScripted(app.loop, app.gpu.device, n, dtSec, (dt, drawFrame) => app.stepScripted(dt, drawFrame), draw),
    state: () => {
      const { game, level } = app.session;
      const duration = level.durationSec;
      const style = app.scene.renderStyle;
      const lava = app.scene.lavaReading();
      return {
        mode: 'virtual',
        view: app.view,
        level: level.id,
        levelName: level.name,
        levelIndex: LEVELS.indexOf(level),
        phase: game.phase,
        elapsedSec: game.elapsedSec,
        durationSec: Number.isFinite(duration) ? duration : null,
        rainRate: game.currentRainRate(),
        eruptionRate: game.currentLavaRate(),
        villages: game.villages.map((v) => ({
          name: v.spec.name,
          state: v.state,
          floodedSec: v.floodedSec,
          burnedSec: v.burnedSec,
          lostTo: v.lostTo,
          x: v.x,
          y: v.y,
          radius: v.radius,
        })),
        probeDepths: Array.from(app.scene.probeValues() ?? []),
        lavaActive: app.session.lava.active,
        lavaProbe: lava ? { villages: Array.from(lava.villages), max: lava.max } : null,
        loading: app.levels.loading,
        place: app.levels.place,
        openEdges: { ...level.openEdges },
        seaLevel: style.seaLevel,
        heightRange: { min: style.minHeight, max: style.maxHeight },
        sculptMax: app.levels.sculptMax,
        camera: { yaw: app.camera.yaw, pitch: app.camera.pitch },
        mapTurned: app.geometry().rotated ?? false,
        summary: game.summary(),
        tool: app.tool,
        lavaTool: allowsLavaTool(level),
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
