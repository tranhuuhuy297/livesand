// What the virtual-mode HUD and shortcuts can do: level flow, real places, free-play extras, tools, view and sharing.
import { allowsLavaTool, FREE_PLAY_LAND_COUNT, freePlayLevel, isFreePlay, LEVELS } from '../game/level-definitions';
import { urlForMode } from './app-url-params';
import type { HudActions } from './hud-snapshot';
import { toggleDocumentFullscreen } from './keyboard-shortcuts';
import { cleanPlaceName, clampPlaceWidthKm } from './place-url-param';
import { clampBrushRadius, SIM_SPEEDS } from './sculpt-tool-settings';
import { shareLink } from './share-link';
import type { VirtualModeApp } from './virtual-mode-app';

export interface VirtualModeActions extends HudActions {
  /** First tool contact of a stroke: starts a level waiting on its briefing and remembers the attempt was worked on. */
  onStrokeStart(): void;
}

export function createVirtualModeActions(app: VirtualModeApp): VirtualModeActions {
  let freePlayIndex = 0;
  const actions: VirtualModeActions = {
    selectLevel(id) {
      void app.levels.request({ kind: 'level', id });
    },
    selectPlace(id) {
      void app.levels.request({ kind: 'place', id });
    },
    loadLivePlace(lat, lon, widthKm, name) {
      const label = cleanPlaceName(name);
      void app.levels.request({ kind: 'live', lat, lon, widthKm: clampPlaceWidthKm(widthKm), ...(label ? { name: label } : {}) });
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
      app.levels.applyNow(freePlayLevel(freePlayIndex, Math.floor(Math.random() * 1e6)));
      app.session.setFreePlayRain(rain);
    },
    toggleRain() {
      app.session.setFreePlayRain(!app.session.freePlayRain);
    },
    shareLevel() {
      const name = app.levels.place?.name ?? app.session.level.name;
      void shareLink(`${name} in LiveSand`, `${name} in LiveSand: real terrain and water you can dig, in the browser.`, window.location.href).then((outcome) => {
        if (outcome === 'copied') app.hud.showToast('Link copied');
        else if (outcome === 'failed') app.hud.showToast('Copy the link from the address bar');
      });
    },
    floodPlace() {
      if (!app.levels.startStorm()) app.hud.showToast('Open a real place first');
    },
    leaveLevel() {
      if (!(app.session.level.place && app.levels.returnToPlace())) actions.selectLevel('sandbox');
    },
    setTool(tool) {
      if (tool === 'lava' && !allowsLavaTool(app.session.level)) {
        app.hud.showToast('Lava is for free play and Mount Ember');
        return;
      }
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
