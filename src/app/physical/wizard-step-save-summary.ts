// Wizard step 5: summary of the calibration before it is saved to this browser.
import type { WizardStep, WizardStepContext } from './calibration-wizard-types';
import { el } from './dom-builder';
import { heightRangeOf, identityKeystone } from './physical-calibration-model';
import { quadsEqual } from './quad-geometry';

export class SaveSummaryStep implements WizardStep {
  readonly title = 'Save the calibration';
  readonly short = 'Save';
  private readonly ctx: WizardStepContext;

  constructor(ctx: WizardStepContext) {
    this.ctx = ctx;
  }

  mount(body: HTMLElement): void {
    const cal = this.ctx.buildCalibration();
    const { draft } = this.ctx;
    if (!cal) {
      body.append(el('p', { className: 'lsp-lead', text: 'Some steps are incomplete. Go back and finish them.' }));
      this.ctx.refresh();
      return;
    }
    const range = heightRangeOf(cal);
    const stats = draft.referenceStats;
    const rows: [string, string][] = [
      ['Depth camera', `${cal.depthWidth} × ${cal.depthHeight} px`],
      ['Sandbox', `4 corners set · ${cal.boxWidthCm} cm wide`],
      [
        'Flat sand',
        `${cal.referencePlaneMeters.toFixed(3)} m from the sensor${stats ? ` · ±${(stats.spreadMeters * 1000).toFixed(0)} mm` : ''}`,
      ],
      ['Relief', `dig ${draft.digCm} cm · pile ${draft.pileCm} cm → heights 0–${range.max.toFixed(0)} (flat ${range.flat.toFixed(0)})`],
      [
        'Projector',
        !this.ctx.host.keystoneSurface.element
          ? 'no projector view attached'
          : quadsEqual(cal.keystone, identityKeystone()) ? 'not corner-pinned' : 'corner-pinned',
      ],
    ];
    body.append(
      el('dl', 'lsp-summary', rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
      el('p', {
        className: 'lsp-tip',
        text: 'Saved in this browser and reused automatically next time. Recalibrate whenever the phone, the projector or the box moves.',
      }),
    );
    this.ctx.refresh();
  }

  unmount(): void {}

  tick(): void {}

  canAdvance(): boolean {
    return this.ctx.buildCalibration() !== null;
  }

  nextLabel(): string {
    return 'Save & start';
  }
}
