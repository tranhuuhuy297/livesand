// Wizard step 3: box width sets the height scale; dig/pile limits set the relief range, with a live terrain preview.
import type { WizardStep, WizardStepContext } from './calibration-wizard-types';
import { ELEVATION_GRADIENT_CSS, FalseColorCanvas } from './depth-preview-canvas';
import { el } from './dom-builder';
import { heightRangeOf, unitsPerMeterForBox } from './physical-calibration-model';
import { rangeField } from './wizard-form-controls';

export class ReliefRangeStep implements WizardStep {
  readonly title = 'Set the relief range';
  readonly short = 'Relief';
  private readonly ctx: WizardStepContext;
  private readonly preview = new FalseColorCanvas();
  private derived: HTMLElement | null = null;
  private flatMarker: HTMLElement | null = null;
  private legendMax: HTMLElement | null = null;
  private lastHeights: Float32Array | null = null;

  constructor(ctx: WizardStepContext) {
    this.ctx = ctx;
  }

  mount(body: HTMLElement): void {
    const { grid } = this.ctx.host;
    const { draft } = this.ctx;
    const stage = el('div', 'ls-stage', [this.preview.canvas]);
    stage.style.aspectRatio = `${grid.width} / ${grid.height}`;
    stage.style.width = `min(100%, calc(56vh * ${grid.width / grid.height}))`;
    const bar = el('span', 'ls-legend-bar ls-legend-bar--marked');
    bar.style.background = ELEVATION_GRADIENT_CSS;
    this.flatMarker = el('span', { className: 'ls-legend-marker', text: 'flat' });
    bar.append(this.flatMarker);
    this.legendMax = el('span', { text: 'max' });
    const fields = [
      rangeField({
        label: 'Sandbox width', unit: 'cm', min: 30, max: 300, step: 1, value: draft.boxWidthCm, testId: 'box-width',
        hint: 'Inside width of the box along the top edge. Sets how many height units 1 cm of sand is.',
        onInput: (v) => this.update(() => (draft.boxWidthCm = v)),
      }),
      rangeField({
        label: 'Deepest dig below flat sand', unit: 'cm', min: 2, max: 40, step: 1, value: draft.digCm, testId: 'dig-depth',
        onInput: (v) => this.update(() => (draft.digCm = v)),
      }),
      rangeField({
        label: 'Highest pile above flat sand', unit: 'cm', min: 4, max: 60, step: 1, value: draft.pileCm, testId: 'pile-height',
        hint: 'Anything higher (hands, arms) counts as a hand and makes rain.',
        onInput: (v) => this.update(() => (draft.pileCm = v)),
      }),
    ];
    this.derived = el('p', 'ls-derived');
    body.append(el('div', 'ls-step-grid', [
      el('div', 'ls-stage-col', [stage, el('div', 'ls-legend', [el('span', { text: '0 dug' }), bar, this.legendMax])]),
      el('div', 'ls-side', [
        ...fields.map((f) => f.root),
        this.derived,
        el('p', {
          className: 'ls-tip',
          text: 'Pile sand up and dig a pit to check: pits turn deep blue, flat sand green, peaks brown and white. Magenta marks a hand.',
        }),
      ]),
    ]));
    this.lastHeights = null;
    this.update(() => {});
  }

  unmount(): void {
    this.derived = this.flatMarker = this.legendMax = null;
  }

  tick(): void {
    const terrain = this.ctx.host.latestTerrain();
    const cal = this.ctx.buildCalibration();
    if (!terrain || !cal || terrain.heights === this.lastHeights) return;
    this.lastHeights = terrain.heights;
    const range = heightRangeOf(cal);
    this.preview.drawHeights(terrain.heights, this.ctx.host.grid, range.min, range.max, terrain.handMask);
  }

  canAdvance(): boolean {
    return this.ctx.buildCalibration() !== null;
  }

  private update(mutate: () => void): void {
    mutate();
    this.lastHeights = null; // redraw with the new colour range even if no new frame arrives
    this.ctx.previewDraft();
    const { draft, host } = this.ctx;
    const cal = this.ctx.buildCalibration();
    const unitsPerCm = unitsPerMeterForBox(host.grid, draft.boxWidthCm) / 100;
    if (this.derived) {
      this.derived.textContent = cal
        ? `1 cm of sand = ${unitsPerCm.toFixed(2)} height units · terrain 0–${heightRangeOf(cal).max.toFixed(0)} units, flat sand at ${heightRangeOf(cal).flat.toFixed(0)}`
        : 'Capture the flat sand first.';
    }
    if (cal && this.flatMarker && this.legendMax) {
      const range = heightRangeOf(cal);
      this.flatMarker.style.left = `${(range.flat / range.max) * 100}%`;
      this.legendMax.textContent = `${range.max.toFixed(0)} piled`;
    }
    this.ctx.refresh();
  }
}
