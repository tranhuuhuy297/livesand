// Step-by-step calibration overlay: corners -> flat sand -> relief -> projector keystone -> save.
import type { WizardDraft, WizardHost, WizardStep, WizardStepContext, NoticeTone } from './calibration-wizard-types';
import { buildCalibrationFromDraft, createWizardDraft } from './calibration-wizard-draft';
import { button, el } from './dom-builder';
import type { PhysicalCalibration } from './physical-calibration-model';
import { FlatSandCaptureStep } from './wizard-step-flat-sand-capture';
import { ProjectorKeystoneStep } from './wizard-step-projector-keystone';
import { ReliefRangeStep } from './wizard-step-relief-range';
import { SandboxCornersStep } from './wizard-step-sandbox-corners';
import { SaveSummaryStep } from './wizard-step-save-summary';

export interface CalibrationWizardOptions {
  host: WizardHost;
  /** Physical-mode UI layer the overlay is added to. */
  root: HTMLElement;
  frameWidth: number;
  frameHeight: number;
  /** Previous calibration to start from (corners/reference reused if the depth size matches). */
  initial: PhysicalCalibration | null;
  /** True when closing returns to a working calibration; false shows "Skip for now". */
  canCancel: boolean;
  onFinish(cal: PhysicalCalibration): void;
  onClose(): void;
}

export class CalibrationWizard {
  private readonly opts: CalibrationWizardOptions;
  private draft: WizardDraft;
  private readonly ctx: WizardStepContext;
  private readonly steps: WizardStep[];
  private index = 0;
  private readonly overlay: HTMLElement;
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly pills: HTMLElement[];
  private readonly notice: HTMLElement;
  private readonly liveBadge: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private raf = 0;
  private closed = false;
  private mounted = false;

  constructor(opts: CalibrationWizardOptions) {
    this.opts = opts;
    this.draft = createWizardDraft(opts.frameWidth, opts.frameHeight, opts.initial, opts.host.keystoneSurface.keystone);
    const self = this;
    this.ctx = {
      host: opts.host,
      get draft() { return self.draft; },
      layer: opts.root,
      refresh: () => this.refresh(),
      notify: (message, tone) => this.notify(message, tone),
      buildCalibration: () => buildCalibrationFromDraft(opts.host.grid, this.draft),
      previewDraft: () => {
        const cal = buildCalibrationFromDraft(opts.host.grid, this.draft);
        if (cal) opts.host.previewCalibration(cal);
      },
    };
    this.steps = [
      new SandboxCornersStep(this.ctx), new FlatSandCaptureStep(this.ctx), new ReliefRangeStep(this.ctx),
      new ProjectorKeystoneStep(this.ctx), new SaveSummaryStep(this.ctx),
    ];
    this.eyebrow = el('div', 'ls-eyebrow');
    this.liveBadge = el('span', { className: 'ls-live-badge', attrs: { 'data-testid': 'wizard-live' } });
    this.title = el('h2', 'ls-title');
    this.pills = this.steps.map((s, i) => el('li', 'ls-step-pill', [el('span', { className: 'ls-step-num', text: String(i + 1) }), s.short]));
    this.body = el('div', 'ls-wiz-body');
    this.notice = el('div', { className: 'ls-notice', attrs: { role: 'status' } });
    this.backBtn = button('Back', () => this.go(this.index - 1), 'ls-btn ls-btn--ghost');
    this.nextBtn = button('Next', () => this.next(), 'ls-btn ls-btn--primary');
    this.nextBtn.dataset.testid = 'wizard-next';
    const closeBtn = button(opts.canCancel ? 'Cancel' : 'Skip for now', () => opts.onClose(), 'ls-btn ls-btn--ghost');
    closeBtn.dataset.testid = 'wizard-close';
    closeBtn.title = opts.canCancel ? 'Keep the previous calibration' : 'Use a rough automatic calibration until you calibrate';
    const card = el('section', { className: 'ls-card ls-wizard', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sandbox calibration' } }, [
      el('header', 'ls-wiz-head', [el('div', '', [this.eyebrow, this.title]), el('div', 'ls-head-side', [this.liveBadge, el('ol', 'ls-steps', this.pills)])]),
      this.body,
      this.notice,
      el('footer', 'ls-wiz-foot', [this.backBtn, el('span', 'ls-spacer'), closeBtn, this.nextBtn]),
    ]);
    this.overlay = el('div', { className: 'ls-overlay ls-wizard-overlay', attrs: { 'data-testid': 'calibration-wizard' } }, [card]);
    opts.root.append(this.overlay);
    this.go(0);
    this.loop();
  }

  /** 0-based index of the visible step. */
  get stepIndex(): number {
    return this.index;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.unmountCurrent();
    this.overlay.remove();
  }

  /** The depth image size changed mid-wizard: corners and reference no longer apply, so start over. */
  restartForFrameSize(width: number, height: number): void {
    if (width === this.draft.depthWidth && height === this.draft.depthHeight) return;
    const { boxWidthCm, digCm, pileCm, keystone } = this.draft;
    this.unmountCurrent();
    this.draft = { ...createWizardDraft(width, height, null, keystone), boxWidthCm, digCm, pileCm };
    this.go(0);
    this.notify(`The depth image changed to ${width} × ${height}. Mark the corners again.`, 'warn');
  }

  private go(target: number): void {
    if (target < 0 || target >= this.steps.length || this.closed) return;
    this.unmountCurrent();
    this.index = target;
    this.body.replaceChildren();
    this.notify(null);
    const step = this.steps[target];
    this.overlay.classList.toggle('is-compact', Boolean(step.compact));
    this.eyebrow.textContent = `Sandbox calibration · step ${target + 1} of ${this.steps.length}`;
    this.title.textContent = step.title;
    this.pills.forEach((p, i) => {
      p.classList.toggle('is-active', i === target);
      p.classList.toggle('is-done', i < target);
    });
    this.overlay.dataset.step = String(target);
    step.mount(this.body);
    this.mounted = true;
    this.refresh();
  }

  private unmountCurrent(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.steps[this.index].unmount();
  }

  private next(): void {
    const step = this.steps[this.index];
    if (!step.canAdvance()) return;
    if (this.index < this.steps.length - 1) {
      this.go(this.index + 1);
      return;
    }
    const cal = buildCalibrationFromDraft(this.opts.host.grid, this.draft);
    if (!cal) {
      this.notify('The calibration is incomplete. Go back and finish the earlier steps.', 'error');
      return;
    }
    this.opts.onFinish({ ...cal, savedAt: Date.now() });
  }

  private refresh(): void {
    const step = this.steps[this.index];
    if (!step) return;
    this.backBtn.disabled = this.index === 0;
    this.nextBtn.disabled = !step.canAdvance();
    this.nextBtn.textContent = step.nextLabel?.() ?? 'Next';
  }

  private notify(message: string | null, tone: NoticeTone = 'info'): void {
    this.notice.textContent = message ?? '';
    this.notice.hidden = !message;
    this.notice.dataset.tone = tone;
  }

  private loop(): void {
    if (this.closed) return;
    const live = this.opts.host.isLive();
    if (this.liveBadge.dataset.live !== String(live)) {
      this.liveBadge.dataset.live = String(live);
      this.liveBadge.textContent = live ? 'Live depth' : 'No depth: waiting for the phone…';
    }
    try {
      this.steps[this.index].tick();
    } catch (err) {
      this.notify(`Preview failed: ${(err as Error).message}`, 'error');
    }
    this.raf = requestAnimationFrame(() => this.loop());
  }
}
