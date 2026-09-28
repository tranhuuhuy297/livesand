// Runs PhysicalModeController against a real relay; draws polled terrain on a stand-in projector surface for e2e.
import { FalseColorCanvas } from '../../src/app/physical/depth-preview-canvas';
import { defaultRelayUrl, PhysicalModeController, type PhysicalStatus } from '../../src/app/physical/physical-mode-controller';
import { DEFAULT_GRID } from '../../src/core/types';

interface HarnessStats {
  polls: number;
  changedPolls: number;
  maxHeight: number;
  minHeight: number;
  flat: number;
  handCells: number;
}

interface PhysicalHarness {
  ready: boolean;
  errors: string[];
  statuses: PhysicalStatus[];
  stats: HarnessStats;
  resetStats(): void;
}

declare global {
  interface Window {
    __physicalHarness: PhysicalHarness;
  }
}

const emptyStats = (): HarnessStats => ({ polls: 0, changedPolls: 0, maxHeight: 0, minHeight: 0, flat: 0, handCells: 0 });

const harness: PhysicalHarness = {
  ready: false,
  errors: [],
  statuses: [],
  stats: emptyStats(),
  resetStats: () => {
    harness.stats = emptyStats();
  },
};
window.__physicalHarness = harness;
window.addEventListener('error', (e) => harness.errors.push(e.message));
window.addEventListener('unhandledrejection', (e) => harness.errors.push(String(e.reason)));

const surface = document.getElementById('surface') as HTMLElement;
const ui = document.getElementById('ui') as HTMLElement;
const view = new FalseColorCanvas('terrain-canvas');
surface.append(view.canvas);

const controller = new PhysicalModeController({
  grid: DEFAULT_GRID,
  relayUrl: defaultRelayUrl(window.location),
  uiRoot: ui,
  onStatus: (s) => harness.statuses.push(s),
});
controller.attachProjectorSurface(surface);
controller.start();

function frame(): void {
  const terrain = controller.poll();
  if (terrain) {
    let max = -Infinity, min = Infinity, hands = 0;
    for (let i = 0; i < terrain.heights.length; i++) {
      if (terrain.handMask[i]) {
        hands++;
        continue;
      }
      max = Math.max(max, terrain.heights[i]);
      min = Math.min(min, terrain.heights[i]);
    }
    const range = controller.heightRange;
    const s = harness.stats;
    s.polls++;
    if (terrain.changed) s.changedPolls++;
    s.maxHeight = max;
    s.minHeight = min;
    s.flat = range.flat;
    s.handCells = hands;
    view.drawHeights(terrain.heights, DEFAULT_GRID, range.min, range.max, terrain.handMask);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
harness.ready = true;
