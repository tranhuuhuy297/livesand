// What the virtual-mode HUD and shortcuts can do: level flow, free-play extras, tools, view and sharing.
import { FREE_PLAY_LAND_COUNT, freePlayLevel, getLevel, isFreePlay, LEVELS } from '../game/level-definitions';
import { replaceUrlParam, urlForMode } from './app-url-params';
import { copyTextToClipboard } from './hud-dom-helpers';
import type { HudActions } from './hud-snapshot';
import { toggleDocumentFullscreen } from './keyboard-shortcuts';
import { clampBrushRadius, SIM_SPEEDS } from './sculpt-tool-settings';
import type { VirtualModeApp } from './virtual-mode-app';
import { defaultToolFor } from './virtual-mode-presets';

export interface VirtualModeActions extends HudActions {
  /** First tool contact of a stroke: starts a level waiting on its briefing and remembers the attempt was worked on. */
  onStrokeStart(): void;
}

export function createVirtualModeActions(app: VirtualModeApp): VirtualModeActions {
  let freePlayIndex = 0;
  const actions: VirtualModeActions = {
    selectLevel(id) {
      const level = getLevel(id);
      app.session.loadLevel(level);
      app.tool = defaultToolFor(level);
      replaceUrlParam('level', level.id);
    },
    startLevel() {
      if (!isFreePlay(app.session.level)) app.session.startGame();
    },
    resetLevel() {
      app.session.loadLevel(app.session.level);
      app.hud.showToast(isFreePlay(app.session.level) ? 'Sandbox reset' : 'Level restarted');
    },
    nextLevel() {
      const i = LEVELS.indexOf(app.session.level);
      actions.selectLevel(i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1].id : 'sandbox');
    },
    onStrokeStart() {
      // Touching the terrain during the briefing starts the level, so "just start digging" works.
      if (app.session.game.phase === 'ready') actions.startLevel();
      if (app.session.game.phase === 'running') app.markSculpted();
    },
    newTerrain() {
      freePlayIndex = (freePlayIndex + 1) % FREE_PLAY_LAND_COUNT;
      const rain = app.session.freePlayRain;
      app.session.loadLevel(freePlayLevel(freePlayIndex, Math.floor(Math.random() * 1e6)));
      app.session.setFreePlayRain(rain);
      replaceUrlParam('level', 'sandbox');
    },
    toggleRain() {
      app.session.setFreePlayRain(!app.session.freePlayRain);
    },
    shareLevel() {
      void copyTextToClipboard(window.location.href).then((ok) => app.hud.showToast(ok ? 'Link copied' : 'Copy the link from the address bar'));
    },
    setTool(tool) {
      app.tool = tool;
    },
    setBrushRadius(radius) {
      app.brushRadius = clampBrushRadius(radius);
    },
    setView(view) {
      app.setView(view);
    },
    cycleSpeed() {
      app.speedIndex = (app.speedIndex + 1) % SIM_SPEEDS.length;
      app.hud.showToast(`Simulation speed ${app.speed}×`);
    },
    toggleFullscreen: toggleDocumentFullscreen,
    openProjectorMode() {
      window.location.assign(urlForMode('projector'));
    },
  };
  return actions;
}
