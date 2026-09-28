// Wizard step 2: the user flattens the sand; the median of ~15 frames becomes the per-cell flat-sand reference.
import { defaultDepthCalibration, DepthTerrainProcessor } from '../../core/depth-terrain-processor';
import type { WizardStep, WizardStepContext } from './calibration-wizard-types';
import { draftRoiQuad } from './calibration-wizard-draft';
import { DepthMedianAccumulator } from './depth-reference-capture';
import { FalseColorCanvas } from './depth-preview-canvas';
import { button, el } from './dom-builder';

// Real sand smoothed by hand is within ~1 cm; more usually means a mound or a tilted phone.
const FLATNESS_WARN_METERS = 0.015;
const COVERAGE_WARN = 0.8;

export class FlatSandCaptureStep implements WizardStep {
  readonly title = 'Capture the flat sand';
  readonly short = 'Flat sand';
  private readonly ctx: WizardStepContext;
  private readonly preview = new FalseColorCanvas();
  private acc: DepthMedianAccumulator | null = null;
  private captureBtn: HTMLButtonElement | null = null;
  private fill: HTMLElement | null = null;
  private result: HTMLElement | null = null;
  private seenSeq = -1;

  constructor(ctx: WizardStepContext) {
    this.ctx = ctx;
  }

  mount(body: HTMLElement): void {
    const { depthWidth: w, depthHeight: h } = this.ctx.draft;
    const stage = el('div', 'ls-stage', [this.preview.canvas]);
    stage.style.aspectRatio = `${w} / ${h}`;
    stage.style.width = `min(100%, calc(56vh * ${w / h}))`;
    this.captureBtn = button('Capture flat sand', () => this.start(), 'ls-btn ls-btn--primary ls-btn--wide');
    this.captureBtn.dataset.testid = 'capture-reference';
    this.fill = el('div', 'ls-progress-fill');
    this.result = el('div', { className: 'ls-result', attrs: { 'data-testid': 'capture-result' } });
    body.append(el('div', 'ls-step-grid', [
      el('div', 'ls-stage-col', [stage]),
      el('div', 'ls-side', [
        el('p', { className: 'ls-lead', text: 'Smooth the sand so it is flat and level, take your hands out of the box, then capture.' }),
        el('p', {
          className: 'ls-tip',
          text: 'LiveSand takes the per-pixel median of 15 depth frames as its flat-sand reference; every height is measured from it. Recapture whenever the phone moves.',
        }),
        this.captureBtn,
        el('div', 'ls-progress', [this.fill]),
        this.result,
      ]),
    ]));
    this.seenSeq = -1;
    this.render();
  }

  unmount(): void {
    this.acc = null; // leaving the step aborts a capture in progress
    this.captureBtn = this.fill = this.result = null;
  }

  tick(): void {
    const latest = this.ctx.host.latestFrame();
    const { depthWidth, depthHeight } = this.ctx.draft;
    if (!latest || latest.seq === this.seenSeq || latest.frame.width !== depthWidth || latest.frame.height !== depthHeight) return;
    this.seenSeq = latest.seq;
    this.preview.drawDepth(latest.frame);
    if (!this.acc) return;
    this.acc.add(latest.frame);
    if (this.acc.complete) this.finish(this.acc);
    else this.render();
  }

  canAdvance(): boolean {
    return this.acc === null && this.ctx.draft.referencePlaneMeters !== null;
  }

  private start(): void {
    const { depthWidth, depthHeight } = this.ctx.draft;
    this.acc = new DepthMedianAccumulator(depthWidth, depthHeight);
    this.ctx.notify(null);
    this.render();
  }

  private finish(acc: DepthMedianAccumulator): void {
    this.acc = null;
    const { host, draft } = this.ctx;
    const roi = draftRoiQuad(draft);
    try {
      if (!roi) throw new Error('the sandbox corners are not set');
      const frame = acc.median();
      const processor = new DepthTerrainProcessor(host.grid, {
        ...defaultDepthCalibration(host.grid, draft.depthWidth, draft.depthHeight),
        roiQuad: roi,
      });
      const raw = processor.resampleDepth(frame);
      const reference = processor.captureReference(frame);
      let valid = 0, sum = 0, sumSq = 0;
      for (let i = 0; i < raw.length; i++) if (raw[i] > 0) valid++;
      for (const d of reference) { sum += d; sumSq += d * d; }
      const mean = sum / reference.length;
      const spread = Math.sqrt(Math.max(0, sumSq / reference.length - mean * mean));
      draft.referenceDepth = reference;
      draft.referencePlaneMeters = mean;
      draft.referenceStats = { frames: acc.count, meanMeters: mean, spreadMeters: spread, validFraction: valid / raw.length };
      this.ctx.previewDraft();
      if (valid / raw.length < COVERAGE_WARN) {
        this.ctx.notify(`${Math.round((1 - valid / raw.length) * 100)}% of the sandbox has no depth. Make sure the phone sees the whole box.`, 'warn');
      } else if (spread > FLATNESS_WARN_METERS) {
        this.ctx.notify(`The sand is not flat (±${(spread * 100).toFixed(1)} cm). Smooth it and capture again, or continue anyway.`, 'warn');
      }
    } catch (err) {
      this.ctx.notify(`Capture failed: ${(err as Error).message}`, 'error');
    }
    this.render();
  }

  private render(): void {
    const { draft } = this.ctx;
    const capturing = this.acc !== null;
    if (this.captureBtn) {
      this.captureBtn.disabled = capturing;
      this.captureBtn.textContent = capturing
        ? `Capturing… ${this.acc?.count ?? 0}/${this.acc?.capacity ?? 0}`
        : draft.referencePlaneMeters !== null ? 'Capture again' : 'Capture flat sand';
    }
    const progress = capturing && this.acc ? this.acc.count / this.acc.capacity : draft.referencePlaneMeters !== null ? 1 : 0;
    if (this.fill) this.fill.style.width = `${Math.round(progress * 100)}%`;
    if (this.result) {
      const stats = draft.referenceStats;
      this.result.classList.toggle('is-ok', draft.referencePlaneMeters !== null && !capturing);
      this.result.textContent = capturing
        ? 'Hold still…'
        : stats
          ? `✓ Flat sand at ${stats.meanMeters.toFixed(3)} m · ±${(stats.spreadMeters * 1000).toFixed(0)} mm · ${Math.round(stats.validFraction * 100)}% coverage`
          : draft.referencePlaneMeters !== null
            ? `✓ Using the saved reference (${draft.referencePlaneMeters.toFixed(3)} m). Capture again if anything moved.`
            : 'Not captured yet.';
    }
    this.ctx.refresh();
  }
}
